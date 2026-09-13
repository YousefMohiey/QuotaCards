package com.quotacards.tunnel

import android.content.Intent
import android.graphics.drawable.Icon
import android.net.VpnService
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.annotation.RequiresApi

/**
 * Shade toggle: tap = VPN on/off without opening the app.
 * On uses the last saved config (service prefs); first ever connect must
 * happen in-app so the VPN consent dialog has an activity.
 */
@RequiresApi(Build.VERSION_CODES.N)
class QCTileService : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        sync()
    }

    override fun onClick() {
        super.onClick()
        if (TunnelService.running) {
            startService(Intent(this, TunnelService::class.java).setAction(ACTION_STOP))
            syncState(Tile.STATE_INACTIVE)
            return
        }
        // Consent survives once granted; if revoked, fall into the app.
        if (VpnService.prepare(this) != null) {
            val launch = packageManager.getLaunchIntentForPackage(packageName)
            if (launch != null) startActivityAndCollapse(launch)
            return
        }
        val prefs = getSharedPreferences("qc-tunnel", MODE_PRIVATE)
        if (!prefs.getBoolean("want", false) || prefs.getString("config", null).isNullOrBlank()) {
            val launch = packageManager.getLaunchIntentForPackage(packageName)
            if (launch != null) startActivityAndCollapse(launch)
            return
        }
        // Null intent: service restores config + apps from prefs itself.
        androidx.core.content.ContextCompat.startForegroundService(this, Intent(this, TunnelService::class.java))
        syncState(Tile.STATE_ACTIVE)
        val q = qsTile
        if (q != null) {
            q.subtitle = "Connecting…"
            q.updateTile()
        }
    }

    private fun sync() {
        syncState(if (TunnelService.running) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE)
    }

    private fun syncState(s: Int) {
        val q = qsTile ?: return
        q.state = s
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            q.subtitle = if (s == Tile.STATE_ACTIVE) "On" else "Off"
        }
        q.updateTile()
    }

    companion object {
        fun refresh(ctx: android.content.Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
            runCatching {
                requestListeningState(
                    ctx,
                    android.content.ComponentName(ctx, QCTileService::class.java),
                )
            }
        }
    }
}
