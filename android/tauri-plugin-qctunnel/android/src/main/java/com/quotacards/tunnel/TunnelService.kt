package com.quotacards.tunnel

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.IpPrefix
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.Process
import android.system.OsConstants
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationCompat
import io.nekohasekai.libbox.BridgeOptions
import io.nekohasekai.libbox.BridgeSession
import io.nekohasekai.libbox.CommandServer
import io.nekohasekai.libbox.CommandServerHandler
import io.nekohasekai.libbox.ConnectionOwner
import io.nekohasekai.libbox.InterfaceUpdateListener
import io.nekohasekai.libbox.Libbox
import io.nekohasekai.libbox.LocalDNSTransport
import io.nekohasekai.libbox.NeighborUpdateListener
import io.nekohasekai.libbox.NetworkInterfaceIterator
import io.nekohasekai.libbox.Notification
import io.nekohasekai.libbox.OverrideOptions
import io.nekohasekai.libbox.PlatformInterface
import io.nekohasekai.libbox.PlatformUser
import io.nekohasekai.libbox.SetupOptions
import io.nekohasekai.libbox.ShellSession
import io.nekohasekai.libbox.StringIterator
import io.nekohasekai.libbox.SystemProxyStatus
import io.nekohasekai.libbox.TunOptions
import io.nekohasekai.libbox.WIFIState
import java.net.Inet6Address
import java.net.InetSocketAddress
import java.net.InterfaceAddress
import java.net.NetworkInterface
import io.nekohasekai.libbox.NetworkInterface as BoxInterface
import io.nekohasekai.libbox.NeighborEntry as BoxNeighborEntry

private const val TAG = "QCTunnel"
const val ACTION_STOP = "com.quotacards.tunnel.STOP"
const val EXTRA_CONFIG = "config"
const val EXTRA_APPS = "apps"
const val EXTRA_APPS_MODE = "apps_mode"
private const val NOTIF_ID = 1001
private const val CHANNEL_ID = "qc-tunnel"

/**
 * Whole-device sing-box tunnel. Proven pattern ported from the official
 * SFA client: CommandServer + VpnService-backed TUN, trimmed to what
 * QuotaCards needs (no root, no profiles, one static config).
 */
class TunnelService :
    VpnService(),
    PlatformInterface,
    CommandServerHandler {

    companion object {
        @Volatile var running = false
        @Volatile var lastError: String? = null
        @Volatile private var setupDone = false
        // Traffic baselines snapped at connect; traffic() reports deltas.
        @Volatile var rxBase = 0L
        @Volatile var txBase = 0L

        // App-side lifecycle trace, prepended to the engine log output.
        private val events = ArrayDeque<String>()
        @Synchronized
        fun ev(msg: String) {
            events.addLast("${System.currentTimeMillis()}: $msg")
            while (events.size > 60) events.removeFirst()
        }

        fun readLogTail(maxLines: Int): String {
            return try {
                val head = synchronized(events) { events.toList() }.joinToString("\n")
                val f = java.io.File(
                    appContext?.filesDir ?: return head,
                    "qc-tunnel.log",
                )
                if (!f.exists()) return head.ifEmpty { "" }
                val lines = f.readLines()
                (head + "\n--- engine ---\n" + lines.takeLast(maxLines).joinToString("\n"))
                    .takeLast(60000)
            } catch (e: Exception) {
                ""
            }
        }

        @Volatile private var appContext: android.content.Context? = null

        @Synchronized
        fun ensureSetup(ctx: Context) {
            if (setupDone) return
            val opts = SetupOptions()
            opts.basePath = ctx.filesDir.path
            opts.workingPath = (ctx.getExternalFilesDir(null) ?: ctx.filesDir).path
            opts.tempPath = ctx.cacheDir.path
            Libbox.setup(opts)
            setupDone = true
        }
    }

    private val connectivity: ConnectivityManager by lazy {
        getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
    }
    private val notifManager: NotificationManager by lazy {
        getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    }

    private var box: CommandServer? = null
    private var tunPfd: ParcelFileDescriptor? = null
    private var netCallback: ConnectivityManager.NetworkCallback? = null
    private var ifaceListener: InterfaceUpdateListener? = null
    // Start/stop generations: a stop invalidates in-flight starts so a slow
    // start can never resurrect a zombie tunnel after the user disconnected.
    @Volatile private var gen = 0
    @Volatile private var activeGen = 0
    @Volatile private var starting = false

    // ---------- Service lifecycle ----------

    override fun onCreate() {
        super.onCreate()
        appContext = applicationContext
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            notifManager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "QuotaCards VPN",
                    NotificationManager.IMPORTANCE_LOW,
                ),
            )
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prefs = getSharedPreferences("qc-tunnel", MODE_PRIVATE)
        if (intent?.action == ACTION_STOP) {
            Log.i(TAG, "stop action received")
            ev("stop action received")
            prefs.edit().putBoolean("want", false).apply()
            stopBox()
            stopSelf()
            return START_NOT_STICKY
        }
        var config = intent?.getStringExtra(EXTRA_CONFIG)
        var apps = intent?.getStringExtra(EXTRA_APPS) ?: ""
        var appsMode = intent?.getStringExtra(EXTRA_APPS_MODE) ?: ""
        if (config.isNullOrBlank()) {
            // Process-death restart: resume only if the user left the VPN on.
            if (prefs.getBoolean("want", false)) {
                config = prefs.getString("config", null)
                apps = prefs.getString("apps", "") ?: ""
                appsMode = prefs.getString("apps_mode", "") ?: ""
                if (!config.isNullOrBlank()) ev("restart resume, config restored")
            }
        } else {
            prefs.edit().putString("config", config).putString("apps", apps)
                .putString("apps_mode", appsMode).putBoolean("want", true).apply()
        }
        if (config.isNullOrBlank()) {
            if (!running) stopSelf()
            return START_STICKY
        }
        if (running || starting) return START_STICKY
        gen++
        val myGen = gen
        activeGen = myGen
        starting = true
        ev("start cmd gen=$myGen")
        startForegroundCompat(buildOngoing("Starting…"))
        Thread({
            try {
                ensureSetup(this)
                Libbox.checkConfig(config)
                val server = CommandServer(this, this)
                server.start()
                server.startOrReloadService(config, OverrideOptions())
                if (myGen != gen) {
                    // stopped while starting: tear it straight back down
                    ev("gen=$myGen superseded, abandoning")
                    abandon(server)
                    return@Thread
                }
                box = server
                lastError = null
                running = true
                getSharedPreferences("qc-tunnel", MODE_PRIVATE).edit().putInt("fails", 0).apply()
                ev("gen=$myGen tunnel started")
                startForegroundCompat(buildOngoing("Connected"))
                runCatching { QCTileService.refresh(this) }
                Log.i(TAG, "tunnel started")
            } catch (e: Exception) {
                Log.e(TAG, "start failed", e)
                ev("gen=$myGen start failed: ${e.message}")
                if (myGen == gen) {
                    lastError = e.message ?: e.toString()
                    running = false
                    // Cap unattended restarts: five straight failures and we
                    // stand down instead of looping forever with no network.
                    val prefs = getSharedPreferences("qc-tunnel", MODE_PRIVATE)
                    val fails = prefs.getInt("fails", 0) + 1
                    if (fails >= 5) {
                        ev("too many restarts, standing down")
                        prefs.edit().putBoolean("want", false).putInt("fails", 0).apply()
                    } else {
                        prefs.edit().putInt("fails", fails).apply()
                    }
                    stopBox()
                    stopSelf()
                }
            } finally {
                if (myGen == gen) starting = false
            }
        }, "qc-tunnel-start").start()
        return START_STICKY
    }

    // Close a superseded engine that finished starting after a stop.
    private fun abandon(server: CommandServer) {
        Thread({
            runCatching { tunPfd?.close() }
            tunPfd = null
            runCatching { server.closeService() }
            runCatching { server.close() }
        }, "qc-tunnel-abandon").start()
    }

    private fun stopBox() {
        gen++
        starting = false
        running = false
        ev("stopBox gen=$gen")
        runCatching { tunPfd?.close() }
        tunPfd = null
        runCatching { netCallback?.let { connectivity.unregisterNetworkCallback(it) } }
        netCallback = null
        ifaceListener = null
        val server = box
        box = null
        // native close can block on a wedged engine - never on the main thread
        Thread({
            runCatching { server?.closeService() }
            runCatching { server?.close() }
        }, "qc-tunnel-stop").start()
        runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
        runCatching { QCTileService.refresh(this) }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        // Swipe-away must never drop the tunnel: re-post the start command.
        // No config in the intent means the resume path rebuilds from prefs.
        if (getSharedPreferences("qc-tunnel", MODE_PRIVATE).getBoolean("want", false)) {
            ev("task removed, keeping tunnel")
            runCatching {
                ContextCompat.startForegroundService(this, Intent(this, TunnelService::class.java))
            }
        }
    }

    override fun onRevoke() {
        Log.i(TAG, "revoked by system")
        ev("revoked by system")
        getSharedPreferences("qc-tunnel", MODE_PRIVATE).edit().putBoolean("want", false).apply()
        stopBox()
        stopSelf()
    }

    override fun onDestroy() {
        Log.i(TAG, "service destroyed")
        ev("service destroyed")
        stopBox()
        super.onDestroy()
    }

    private fun startForegroundCompat(notif: android.app.Notification) {
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                NOTIF_ID,
                notif,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED,
            )
        } else {
            startForeground(NOTIF_ID, notif)
        }
    }

    // App icon as the notification icon (status bar + shade), so it
    // shows the Q logo instead of a generic glyph.
    private fun appIconId(): Int =
        runCatching {
            packageManager.getApplicationInfo(packageName, 0).icon
        }.getOrDefault(android.R.drawable.ic_dialog_info)

    // Tap the notification = back into the app.
    private fun appTapIntent(): android.app.PendingIntent? =
        runCatching {
            val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            } ?: return@runCatching null
            android.app.PendingIntent.getActivity(
                this,
                0,
                launch,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or
                    android.app.PendingIntent.FLAG_IMMUTABLE,
            )
        }.getOrNull()

    private fun buildOngoing(text: String): android.app.Notification {
        val b = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("QuotaCards VPN")
            .setContentText(text)
            .setSmallIcon(appIconId())
            .setOngoing(true)
        appTapIntent()?.let { b.setContentIntent(it) }
        return b.build()
    }

    // ---------- CommandServerHandler ----------

    override fun serviceStop() {
        stopBox()
    }

    override fun serviceReload() {
        // single static config: nothing to reload
    }

    override fun getSystemProxyStatus(): SystemProxyStatus? = null

    override fun setSystemProxyEnabled(isEnabled: Boolean) {
    }

    override fun triggerNativeCrash() {
        Log.w(TAG, "triggerNativeCrash ignored")
    }

    override fun writeDebugMessage(message: String?) {
        Log.d("sing-box", message ?: "")
    }

    override fun connectSSHAgent(): Int = -1

    // ---------- PlatformInterface ----------

    override fun usePlatformAutoDetectInterfaceControl(): Boolean = true

    override fun autoDetectInterfaceControl(fd: Int) {
        protect(fd)
    }

    override fun openTun(options: TunOptions): Int {
        if (prepare(this) != null) error("android: missing vpn permission")
        val builder = Builder()
            .setSession("QuotaCards")
            .setMtu(options.mtu)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            builder.setMetered(false)
        }
        var inet4 = options.inet4Address
        var has4 = false
        while (inet4.hasNext()) {
            val a = inet4.next()
            builder.addAddress(a.address(), a.prefix())
            has4 = true
        }
        var inet6 = options.inet6Address
        var has6 = false
        while (inet6.hasNext()) {
            val a = inet6.next()
            builder.addAddress(a.address(), a.prefix())
            has6 = true
        }
        if (options.autoRoute) {
            if (options.dnsMode.value != Libbox.DNSModeDisabled) {
                var dns = options.dnsServerAddress
                while (dns.hasNext()) {
                    runCatching {
                        builder.addDnsServer(java.net.InetAddress.getByName(dns.next()))
                    }
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                var routes4 = options.inet4RouteAddress
                var any4 = false
                while (routes4.hasNext()) {
                    val a = routes4.next()
                    builder.addRoute(a.address(), a.prefix())
                    any4 = true
                }
                if (!any4 && has4) {
                    builder.addRoute("0.0.0.0", 0)
                }
                var routes6 = options.inet6RouteAddress
                var any6 = false
                while (routes6.hasNext()) {
                    val a = routes6.next()
                    builder.addRoute(a.address(), a.prefix())
                    any6 = true
                }
                if (!any6 && has6) {
                    builder.addRoute("::", 0)
                }
                var excl4 = options.inet4RouteExcludeAddress
                while (excl4.hasNext()) {
                    splitPrefix(excl4.next().toPrefix())?.let { (ip, len) ->
                        builder.excludeRoute(IpPrefix(ip, len))
                    }
                }
                var excl6 = options.inet6RouteExcludeAddress
                while (excl6.hasNext()) {
                    splitPrefix(excl6.next().toPrefix())?.let { (ip, len) ->
                        builder.excludeRoute(IpPrefix(ip, len))
                    }
                }
            } else {
                var ranges4 = options.inet4RouteRange
                while (ranges4.hasNext()) {
                    val a = ranges4.next()
                    builder.addRoute(a.address(), a.prefix())
                }
                var ranges6 = options.inet6RouteRange
                while (ranges6.hasNext()) {
                    val a = ranges6.next()
                    builder.addRoute(a.address(), a.prefix())
                }
            }
        }
        val pfd = run {
            // Per-app VPN: allowlist or blocklist, decided in the app UI.
            // Own package is always stripped (the engine protects its sockets;
            // allowlisting self would blackhole the app).
            val mode = getSharedPreferences("qc-tunnel", MODE_PRIVATE)
                .getString("apps_mode", "") ?: ""
            val pkgs = (getSharedPreferences("qc-tunnel", MODE_PRIVATE)
                .getString("apps", "") ?: "")
                .split(",").map { it.trim() }
                .filter { it.isNotEmpty() && it != packageName }
            if (mode == "allow" || mode == "block") {
                if (pkgs.isEmpty()) {
                    ev("per-app $mode with empty list, whole device")
                } else if (mode == "allow") {
                    pkgs.forEach { runCatching { builder.addAllowedApplication(it) } }
                    ev("per-app allow n=${pkgs.size}")
                } else {
                    pkgs.forEach { runCatching { builder.addDisallowedApplication(it) } }
                    ev("per-app block n=${pkgs.size}")
                }
            }
            builder.establish()
        }
            ?: error("android: the application is not prepared or is revoked")
        if (activeGen != gen) {
            // stopped while starting: never hand out this interface
            runCatching { pfd.close() }
            error("android: start superseded")
        }
        tunPfd = pfd
        ev("tun established fd=${pfd.fd}")
        return pfd.fd
    }

    override fun useProcFS(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q

    override fun findConnectionOwner(
        ipProtocol: Int,
        sourceAddress: String,
        sourcePort: Int,
        destinationAddress: String,
        destinationPort: Int,
    ): ConnectionOwner {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) error("android: unsupported")
        val uid = connectivity.getConnectionOwnerUid(
            ipProtocol,
            InetSocketAddress(sourceAddress, sourcePort),
            InetSocketAddress(destinationAddress, destinationPort),
        )
        if (uid == Process.INVALID_UID) error("android: connection owner not found")
        val packages = packageManager.getPackagesForUid(uid)
        return ConnectionOwner().apply {
            userId = uid
            userName = packages?.firstOrNull() ?: ""
            setAndroidPackageNames(StrIter((packages?.toList() ?: emptyList()).iterator()))
        }
    }

    override fun startDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
        ifaceListener = listener
        // Physical transports ONLY: the request must never match our own
        // TUN (once the system routes through the VPN, the VPN network
        // itself has INTERNET capability - reporting tun0 as the uplink
        // sends every dial into our own tunnel and kills all traffic).
        val req = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .addTransportType(NetworkCapabilities.TRANSPORT_CELLULAR)
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET)
            .build()
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                pushDefaultInterface(network)
            }

            override fun onLost(network: Network) {
                // Never blank the uplink on a single loss: a flapping
                // secondary network must not wipe the healthy route
                // (blank uplink = engine dials nothing = dead internet).
                // Re-push current best instead; only a real total loss
                // ends with nothing reported.
                pushDefaultInterface(activeNet())
            }
        }
        netCallback = cb
        connectivity.registerNetworkCallback(req, cb)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            connectivity.activeNetwork?.let { pushDefaultInterface(it) }
        }
    }

    private fun pushDefaultInterface(network: Network?) {
        val listener = ifaceListener ?: return
        // link properties are briefly null on handover - retry, and fall
        // back to any internet-capable network instead of reporting nothing
        // (no reported interface = engine cannot dial anywhere).
        Thread({
            repeat(10) {
                val net = network ?: activeNet() ?: run {
                    Thread.sleep(300)
                    return@repeat
                }
                var uplink = ""
                val ok = runCatching {
                    val props = connectivity.getLinkProperties(net) ?: return@runCatching false
                    val name = props.interfaceName ?: return@runCatching false
                    // Never uplink through a TUN interface (ours or another
                    // app's) - that loops dials back into a tunnel.
                    if (name.startsWith("tun")) return@runCatching false
                    val index = NetworkInterface.getByName(name)?.index ?: return@runCatching false
                    uplink = "$name/$index"
                    listener.updateDefaultInterface(name, index, false, false)
                    true
                }.getOrDefault(false)
                if (ok) {
                    ev("uplink $uplink")
                    // Snapshot what the engine will dial from (same call
                    // it uses). Ends all guessing about table contents.
                    runCatching {
                        val parts = mutableListOf<String>()
                        val iter = getInterfaces()
                        while (iter.hasNext()) {
                            val ni = iter.next()
                            parts.add("${ni.name}/${ni.index}")
                        }
                        ev("ifaces ${parts.joinToString(",")}")
                    }
                    return@Thread
                }
                Thread.sleep(300)
            }
            ev("default iface NOT found")
        }, "qc-netmon").start()
    }

    private fun activeNet(): Network? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            connectivity.activeNetwork?.let { return it }
        }
        return connectivity.allNetworks.firstOrNull()
    }

    override fun closeDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
        runCatching { netCallback?.let { connectivity.unregisterNetworkCallback(it) } }
        netCallback = null
        ifaceListener = null
    }

    override fun getInterfaces(): io.nekohasekai.libbox.NetworkInterfaceIterator {
        val out = mutableListOf<BoxInterface>()
        // Primary: system networks joined with Java interfaces (rich
        // data: DNS, routes, transport type). Per-network guard: one
        // bad entry (e.g. our own fresh TUN) must never abort the
        // whole table. An empty table = the engine dials NOTHING
        // ("no available network interface" on every connection).
        runCatching {
            val javaIfaces = NetworkInterface.getNetworkInterfaces()?.toList() ?: emptyList()
            for (network in connectivity.allNetworks) {
                runCatching {
                    val props = connectivity.getLinkProperties(network) ?: return@runCatching
                    val caps = connectivity.getNetworkCapabilities(network) ?: return@runCatching
                    val name = props.interfaceName ?: return@runCatching
                    if (name.startsWith("tun")) return@runCatching
                    val javaIface = javaIfaces.find { it.name == name } ?: return@runCatching
                    out.add(buildIface(name, javaIface, props, caps))
                }
            }
        }
        // Fallback: raw Java interfaces (name/index/addresses direct
        // from the OS, no LinkProperties join). Guarantees the finder
        // never gets an empty table while the radio is up.
        if (out.isEmpty()) {
            runCatching {
                val seen = mutableSetOf<String>()
                for (ni in NetworkInterface.getNetworkInterfaces()?.toList() ?: emptyList()) {
                    runCatching {
                        if (!ni.isUp || ni.isLoopback || !seen.add(ni.name)) return@runCatching
                        if (ni.name.startsWith("tun")) return@runCatching
                        out.add(BoxInterface().apply {
                            this.name = ni.name
                            dnsServer = StrIter(emptyList<String>().iterator())
                            gateway = StrIter(emptyList<String>().iterator())
                            type = Libbox.InterfaceTypeOther
                            index = ni.index
                            runCatching { mtu = ni.mtu }
                            addresses = StrIter(ni.interfaceAddresses.map { it.toPrefix() }.iterator())
                            flags = OsConstants.IFF_UP or OsConstants.IFF_RUNNING
                        })
                    }
                }
            }
            if (out.isEmpty()) ev("getInterfaces EMPTY")
        }
        return IfaceIter(out.iterator())
    }

    private fun buildIface(
        name: String,
        javaIface: NetworkInterface,
        props: android.net.LinkProperties,
        caps: NetworkCapabilities,
    ): BoxInterface = BoxInterface().apply {
        this.name = name
        dnsServer = StrIter(props.dnsServers.mapNotNull { it.hostAddress }.iterator())
        gateway = StrIter(
            props.routes
                .filter { it.destination?.prefixLength == 0 }
                .mapNotNull { it.gateway }
                .filterNot { it.isAnyLocalAddress }
                .mapNotNull { it.hostAddress }
                .iterator(),
        )
        type = when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> Libbox.InterfaceTypeWIFI
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> Libbox.InterfaceTypeCellular
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> Libbox.InterfaceTypeEthernet
            else -> Libbox.InterfaceTypeOther
        }
        index = javaIface.index
        runCatching { mtu = javaIface.mtu }
        addresses = StrIter(javaIface.interfaceAddresses.map { it.toPrefix() }.iterator())
        // Flags MUST carry IFF_UP: the engine filters its dial table to
        // UP interfaces only, and a zero flag = total blackout ("no
        // available network interface" on every dial). Hidden-API
        // getFlags() reflection returns 0 on new Android (blocked), so
        // build the flags from public API + capabilities, like upstream.
        flags = runCatching {
            var f = 0
            if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                f = f or OsConstants.IFF_UP or OsConstants.IFF_RUNNING
            }
            if (runCatching { javaIface.isUp }.getOrDefault(false)) {
                f = f or OsConstants.IFF_UP
            }
            if (runCatching { javaIface.isLoopback }.getOrDefault(false)) {
                f = f or OsConstants.IFF_LOOPBACK
            }
            if (runCatching { javaIface.isPointToPoint }.getOrDefault(false)) {
                f = f or OsConstants.IFF_POINTOPOINT
            }
            if (runCatching { javaIface.supportsMulticast() }.getOrDefault(false)) {
                f = f or OsConstants.IFF_MULTICAST
            }
            f
        }.getOrDefault(OsConstants.IFF_UP or OsConstants.IFF_RUNNING)
        metered = !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }

    override fun underNetworkExtension(): Boolean = false

    override fun includeAllNetworks(): Boolean = false

    override fun clearDNSCache() {
    }

    override fun readWIFIState(): WIFIState? = null

    override fun localDNSTransport(): LocalDNSTransport? = null

    override fun startNeighborMonitor(listener: NeighborUpdateListener?) {
    }

    override fun closeNeighborMonitor(listener: NeighborUpdateListener?) {
    }

    override fun registerMyInterface(name: String?) {
    }

    override fun usePlatformShell(): Boolean = false

    override fun checkPlatformShell() {
    }

    override fun openShellSession(
        user: PlatformUser?,
        command: String?,
        environ: StringIterator?,
        term: String?,
        rows: Int,
        cols: Int,
    ): ShellSession = error("not supported")

    override fun readSystemSSHHostKey(): String = error("not supported")

    override fun lookupSFTPServer(): String = error("not supported")

    override fun lookupUser(username: String?): PlatformUser = error("not supported")

    override fun tailscaleHostname(): String = "${Build.MANUFACTURER} ${Build.MODEL}"

    override fun usePlatformBridge(): Boolean = false

    override fun createBridge(options: BridgeOptions?): BridgeSession = error("not supported")

    override fun sendNotification(notification: Notification) {
        runCatching {
            val channel = "qc-${notification.typeID}"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                notifManager.createNotificationChannel(
                    NotificationChannel(
                        channel,
                        notification.typeName,
                        NotificationManager.IMPORTANCE_HIGH,
                    ),
                )
            }
            val b = NotificationCompat.Builder(this, channel)
                .setContentTitle(notification.title)
                .setContentText(notification.body)
                .setSmallIcon(appIconId())
                .setAutoCancel(true)
            appTapIntent()?.let { b.setContentIntent(it) }
            if (!notification.subtitle.isNullOrBlank()) b.setContentInfo(notification.subtitle)
            notifManager.notify(notification.identifier, notification.typeID, b.build())
        }
    }

    override fun cancelNotification(identifier: String, typeID: Int) {
        runCatching { notifManager.cancel(identifier, typeID) }
    }

    // ---------- small iterator helpers (same shape as upstream SFA) ----------

    class StrIter(source: Iterator<String>) : StringIterator {
        private val items = source.asSequence().toList()
        private var pos = 0
        override fun len(): Int = items.size
        override fun hasNext(): Boolean = pos < items.size
        override fun next(): String = items[pos++]
    }

    private class IfaceIter(
        private val it: Iterator<BoxInterface>,
    ) : io.nekohasekai.libbox.NetworkInterfaceIterator {
        override fun hasNext(): Boolean = it.hasNext()
        override fun next(): BoxInterface = it.next()
    }

    private fun InterfaceAddress.toPrefix(): String =
        if (address is Inet6Address) {
            "${Inet6Address.getByAddress(address.address).hostAddress}/$networkPrefixLength"
        } else {
            "${address.hostAddress}/$networkPrefixLength"
        }

    private fun io.nekohasekai.libbox.RoutePrefix.toPrefix(): String =
        "${address()}/${prefix()}"

    private fun splitPrefix(prefix: String): Pair<java.net.InetAddress, Int>? =
        runCatching {
            val slash = prefix.lastIndexOf('/')
            val ip = java.net.InetAddress.getByName(prefix.substring(0, slash))
            val len = prefix.substring(slash + 1).toInt()
            ip to len
        }.getOrNull()
}
