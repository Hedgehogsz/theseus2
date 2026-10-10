package uk.theseus.survival

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Single activity hosting the offline web UI from assets/.
 *
 * Battery design: no services, no wakelocks, no FLAG_KEEP_SCREEN_ON, no timers on the
 * native side. WebView timers are paused whenever the activity is not visible.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    lateinit var kiosk: Kiosk
        private set
    lateinit var prefs: Prefs
        private set

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        kiosk = Kiosk(this)
        applyBrightness(prefs.brightness)
        // Respect the system screen timeout: make sure nobody set keep-screen-on.
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        WebView.setWebContentsDebuggingEnabled(debuggable)

        webView = WebView(this).apply {
            setBackgroundColor(Color.rgb(0x0E, 0x11, 0x12))
            overScrollMode = View.OVER_SCROLL_NEVER
            isHapticFeedbackEnabled = false
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true // localStorage for favourites, recents and settings
                allowFileAccess = false // file:///android_asset still works
                allowContentAccess = false
                blockNetworkLoads = true // belt and braces: there is no INTERNET permission either
                setGeolocationEnabled(false)
                safeBrowsingEnabled = false // otherwise WebView may try to reach Google
                mediaPlaybackRequiresUserGesture = true
                setSupportZoom(false) // the image viewer implements its own pinch-zoom
                builtInZoomControls = false
                displayZoomControls = false
                textZoom = 100 // text size is controlled inside the app
                cacheMode = WebSettings.LOAD_NO_CACHE
                offscreenPreRaster = false
                setSupportMultipleWindows(false)
                javaScriptCanOpenWindowsAutomatically = false
            }
            webViewClient = GuideClient()
            addJavascriptInterface(WebBridge(this@MainActivity), "Android")
        }
        setContentView(webView)

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        }
        if (webView.url == null) {
            webView.loadUrl("file:///android_asset/index.html")
        }
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        webView.resumeTimers()
        kiosk.enterIfAllowed()
    }

    override fun onPause() {
        // Stop JS timers, layout and rendering work while the guide is not visible.
        webView.onPause()
        webView.pauseTimers()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // Pressing Home while the guide is already open returns to the guide's home screen.
        if (intent.hasCategory(Intent.CATEGORY_HOME)) {
            webView.evaluateJavascript("window.appGoHome && window.appGoHome()", null)
        }
    }

    @Deprecated("Deprecated in Java")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        when {
            webView.canGoBack() -> webView.goBack()
            // As the home launcher (or pinned in kiosk mode) there is nothing behind us.
            intent?.hasCategory(Intent.CATEGORY_HOME) == true || kiosk.isInLockTask() -> Unit
            else -> super.onBackPressed()
        }
    }

    override fun onDestroy() {
        Torch.off(this)
        webView.destroy()
        super.onDestroy()
    }

    /** value in 0..1 overrides the system brightness for this window; negative follows the system. */
    fun applyBrightness(value: Float) {
        val lp = window.attributes
        lp.screenBrightness = if (value < 0f) {
            WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
        } else {
            // 0 can switch some panels' backlight fully off; keep a sliver of light.
            value.coerceIn(0.004f, 1f)
        }
        window.attributes = lp
    }

    @Suppress("DEPRECATION") // systemUiVisibility flags are the API 26-29 way to get dark bar icons
    fun setSystemBarColor(color: Int) {
        window.statusBarColor = color
        window.navigationBarColor = color
        val light = Color.luminance(color) > 0.5f
        var flags = window.decorView.systemUiVisibility
        flags = if (light) {
            flags or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        } else {
            flags and (View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR).inv()
        }
        window.decorView.systemUiVisibility = flags
        webView.setBackgroundColor(color)
    }

    private inner class GuideClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            return when {
                uri.scheme == "file" && uri.path?.startsWith("/android_asset/") == true -> false
                else -> true // never leave the app, open a dialler or touch the network
            }
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // Renderer was killed (low memory). Rebuild the activity rather than crash.
            recreate()
            return true
        }
    }
}
