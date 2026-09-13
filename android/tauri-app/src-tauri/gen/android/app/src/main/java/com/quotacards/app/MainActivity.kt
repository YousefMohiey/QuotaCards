package com.quotacards.app

import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.quotacards.tunnel.TunnelService

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Edge-to-edge draws the WebView under the status bar - push the content
    // below it so the app header never sits under the clock/battery icons.
    val root = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.statusBars())
      v.setPadding(0, bars.top, 0, 0)
      insets
    }
    // System back walks in-app history (tabs) first. At the last page:
    // VPN on = background the app (HOME behavior), never finish - finishing
    // the activity is what takes the tunnel down on some phones.
    // VPN off = close the UI as normal.
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val wv = findWebView(findViewById(android.R.id.content))
        if (wv != null && wv.canGoBack()) {
          wv.goBack()
        } else if (TunnelService.running) {
          this@MainActivity.moveTaskToBack(true)
        } else {
          isEnabled = false
          this@MainActivity.onBackPressedDispatcher.onBackPressed()
          isEnabled = true
        }
      }
    })
  }

  private fun findWebView(v: View?): WebView? {
    if (v == null) return null
    if (v is WebView) return v
    if (v is ViewGroup) {
      for (i in 0 until v.childCount) {
        findWebView(v.getChildAt(i))?.let { return it }
      }
    }
    return null
  }
}
