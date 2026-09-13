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
