package com.quotacards.tunnel

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import android.os.Process
import androidx.activity.result.ActivityResult
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class StartArgs {
    lateinit var config: String
    var apps: String? = null
    var appsMode: String? = null
}

@InvokeArg
class InstallArgs {
    lateinit var apkUrl: String
}

@TauriPlugin
class TunnelPlugin(private val activity: Activity) : Plugin(activity) {

    @Command
    fun start(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(StartArgs::class.java)
        } catch (e: Exception) {
            invoke.reject("bad args: ${e.message}")
            return
        }
        pendingConfig = args.config
        pendingApps = args.apps
        pendingAppsMode = args.appsMode
        if (Build.VERSION.SDK_INT >= 33 &&
            activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                1001,
            )
        }
        val consent = VpnService.prepare(activity)
        if (consent != null) {
            startActivityForResult(invoke, consent, "onVpnConsent")
        } else {
            startServiceNow(invoke)
        }
    }

    @ActivityCallback
    fun onVpnConsent(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode == Activity.RESULT_OK) {
            startServiceNow(invoke)
        } else {
            invoke.reject("VPN permission denied")
        }
    }

    private fun startServiceNow(invoke: Invoke) {
        val config = pendingConfig
        if (config.isNullOrBlank()) {
            invoke.reject("no config")
            return
        }
        try {
            // Traffic baseline: session up/down = counters now subtracted.
            val uid = Process.myUid()
            TunnelService.rxBase = runCatching {
                android.net.TrafficStats.getUidRxBytes(uid)
            }.getOrDefault(0).coerceAtLeast(0)
            TunnelService.txBase = runCatching {
                android.net.TrafficStats.getUidTxBytes(uid)
            }.getOrDefault(0).coerceAtLeast(0)
            val withLog = injectLogPath(config)
            val intent = Intent(activity, TunnelService::class.java)
                .putExtra(EXTRA_CONFIG, withLog)
                .putExtra(EXTRA_APPS, pendingApps ?: "")
                .putExtra(EXTRA_APPS_MODE, pendingAppsMode ?: "")
            ContextCompat.startForegroundService(activity, intent)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("start failed: ${e.message}")
        }
    }

    @Command
    fun apps(invoke: Invoke) {
        // Launchable user apps for the per-app picker. System packages out.
        try {
            val pm = activity.packageManager
            val mains = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val list = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.queryIntentActivities(mains, android.content.pm.PackageManager.ResolveInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                pm.queryIntentActivities(mains, 0)
            }
            val arr = org.json.JSONArray()
            list.map { it.activityInfo.packageName }.toSortedSet().forEach { pkg ->
                if (pkg == activity.packageName) return@forEach
                val label = runCatching {
                    pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
                }.getOrDefault(pkg)
                arr.put(org.json.JSONObject().put("pkg", pkg).put("label", label))
            }
            val out = JSObject()
            out.put("apps", arr.toString())
            invoke.resolve(out)
        } catch (e: Exception) {
            invoke.reject("apps failed: ${e.message}")
        }
    }

    @Command
    fun checkUpdate(invoke: Invoke) {
        // GitHub latest release for the phone build; versionName is the
        // installed app version. Network runs off the main thread.
        Thread {
            try {
                val current = activity.packageManager
                    .getPackageInfo(activity.packageName, 0).versionName ?: "0"
                val conn = java.net.URL(
                    "https://api.github.com/repos/YousefMohiey/QuotaVPN/releases/latest",
                ).openConnection() as java.net.HttpURLConnection
                conn.setRequestProperty("Accept", "application/vnd.github+json")
                conn.setRequestProperty("User-Agent", "quotacards-updater")
                conn.connectTimeout = 15000
                conn.readTimeout = 15000
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                val v = org.json.JSONObject(body)
                val tag = v.optString("tag_name").trimStart('v', 'V')
                var apk = ""
                v.optJSONArray("assets")?.let { arr ->
                    for (i in 0 until arr.length()) {
                        val a = arr.getJSONObject(i)
                        if (a.optString("name") == "QuotaVPN-mobile-signed.apk") {
                            apk = a.optString("browser_download_url")
                        }
                    }
                }
                val out = JSObject()
                out.put("current", current)
                out.put("latest", tag)
                out.put("available", isNewer(tag, current))
                out.put("apkUrl", apk)
                out.put("url", v.optString("html_url"))
                activity.runOnUiThread { invoke.resolve(out) }
            } catch (e: Exception) {
                activity.runOnUiThread { invoke.reject("check failed: ${e.message}") }
            }
        }.start()
    }

    private fun isNewer(latest: String, current: String): Boolean {
        val a = latest.split('.').map { it.toIntOrNull() ?: 0 }
        val b = current.split('.').map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrElse(i) { 0 }
            val y = b.getOrElse(i) { 0 }
            if (x != y) return x > y
        }
        return false
    }

    @Command
    fun installUpdate(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(InstallArgs::class.java)
        } catch (e: Exception) {
            invoke.reject("bad args: ${e.message}")
            return
        }
        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            // First time: Android requires allowing installs from this source.
            runCatching {
                activity.startActivity(
                    Intent(
                        android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        android.net.Uri.parse("package:" + activity.packageName),
                    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
            invoke.reject("allow install from this app, then tap again")
            return
        }
        Thread {
            try {
                val f = java.io.File(activity.cacheDir, "quotacards-update.apk")
                runCatching { if (f.exists()) f.delete() }
                val conn = java.net.URL(args.apkUrl).openConnection() as java.net.HttpURLConnection
                conn.instanceFollowRedirects = true
                conn.connectTimeout = 20000
                conn.readTimeout = 60000
                conn.inputStream.use { input ->
                    f.outputStream().use { out -> input.copyTo(out) }
                }
                if (f.length() < 1_000_000) throw IllegalStateException("download incomplete")
                val uri = androidx.core.content.FileProvider.getUriForFile(
                    activity,
                    activity.packageName + ".fileprovider",
                    f,
                )
                val i = Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                activity.startActivity(i)
                activity.runOnUiThread { invoke.resolve() }
            } catch (e: Exception) {
                activity.runOnUiThread { invoke.reject("install failed: ${e.message}") }
            }
        }.start()
    }

    @Command
    fun openVpnSettings(invoke: Invoke) {
        // System VPN screen: user flips on Always-on + Block connections here.
        try {
            val i = Intent("android.net.vpn.SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(i)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("settings failed: ${e.message}")
        }
    }

    @Command
    fun bgStatus(invoke: Invoke) {
        // True once the user allowed background running (exempt from
        // battery optimization). The Settings toggle reads this label.
        try {
            val pm = activity.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
            val out = JSObject()
            out.put("exempt", pm.isIgnoringBatteryOptimizations(activity.packageName))
            invoke.resolve(out)
        } catch (e: Exception) {
            invoke.reject("settings failed: ${e.message}")
        }
    }

    @Command
    fun openBgSettings(invoke: Invoke) {
        // Battery-exemption screen: the fix for phones that kill the VPN
        // when the app is swiped away. Not exempt yet: ask to allow.
        // Already exempt: open the system list so the user can disallow.
        try {
            val pm = activity.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
            val i = if (!pm.isIgnoringBatteryOptimizations(activity.packageName)) {
                Intent(
                    android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    android.net.Uri.parse("package:" + activity.packageName),
                )
            } else {
                Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(i)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("settings failed: ${e.message}")
        }
    }

    // sing-box file log, absolute path - the only window into the engine.
    private fun injectLogPath(config: String): String {
        val logFile = java.io.File(activity.filesDir, "qc-tunnel.log")
        runCatching { if (logFile.exists()) logFile.delete() }
        return try {
            val root = org.json.JSONObject(config)
            val log = root.optJSONObject("log") ?: org.json.JSONObject()
            log.put("level", "debug")
            log.put("output", logFile.absolutePath)
            root.put("log", log)
            root.toString()
        } catch (e: Exception) {
            config
        }
    }

    @Command
    fun stop(invoke: Invoke) {
        TunnelService.ev("stop cmd from app")
        // Two kill paths, either suffices alone. The explicit intent is
        // always delivered (even mid-start); stopService drops pending
        // starts. Together no zombie survives either ordering.
        runCatching {
            activity.startService(
                Intent(activity, TunnelService::class.java).setAction(ACTION_STOP),
            )
        }.onFailure { TunnelService.ev("stop intent failed: ${it.message}") }
        val stopped = runCatching {
            activity.stopService(Intent(activity, TunnelService::class.java))
        }.getOrDefault(false)
        TunnelService.ev("stopService returned=$stopped")
        // NOTE: running flips inside stopBox on the service itself, so
        // status only reads off once teardown really began. Never flip
        // it here: a lie here is exactly "app says off, phone says on".
        invoke.resolve()
    }

    @Command
    fun status(invoke: Invoke) {
        val out = JSObject()
        out.put("running", TunnelService.running)
        out.put("error", TunnelService.lastError ?: "")
        invoke.resolve(out)
    }

    // Session traffic, bytes since connect (baselines in startServiceNow).
    @Command
    fun traffic(invoke: Invoke) {
        val out = JSObject()
        val uid = Process.myUid()
        val rx = runCatching {
            android.net.TrafficStats.getUidRxBytes(uid)
        }.getOrDefault(0).coerceAtLeast(0)
        val tx = runCatching {
            android.net.TrafficStats.getUidTxBytes(uid)
        }.getOrDefault(0).coerceAtLeast(0)
        out.put("rx", (rx - TunnelService.rxBase).coerceAtLeast(0))
        out.put("tx", (tx - TunnelService.txBase).coerceAtLeast(0))
        invoke.resolve(out)
    }

    @Command
    fun log(invoke: Invoke) {
        val out = JSObject()
        out.put("lines", TunnelService.readLogTail(300))
        invoke.resolve(out)
    }

    companion object {
        @Volatile private var pendingConfig: String? = null
        @Volatile private var pendingApps: String? = null
        @Volatile private var pendingAppsMode: String? = null
    }
}
