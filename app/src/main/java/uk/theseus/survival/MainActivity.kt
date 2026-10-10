package uk.theseus.survival

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.view.WindowManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

/**
 * Single activity hosting the offline web UI.
 *
 * The UI is served from the APK's assets at https://appassets.androidplatform.net/ by [WebViewAssetLoader] (a
 * reserved domain that never touches the network), and the offline map files from the phone's storage at
 * /maps/... with HTTP range support ([MapFiles]). There is no INTERNET permission and network loads are blocked.
 *
 * Battery design: no services, no wakelocks, nothing running when the guide isn't on screen. In onPause the WebView's
 * timers are paused and every sensor, the GPS, any torch/sound pattern and text-to-speech are stopped.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var assets: WebViewAssetLoader
    lateinit var prefs: Prefs
        private set
    lateinit var phoneMode: PhoneMode
        private set
    lateinit var sensors: SensorHub
        private set
    lateinit var gps: GpsHub
        private set
    lateinit var signals: Signals
        private set
    lateinit var speech: Speech
        private set
    private val handler = Handler(Looper.getMainLooper())

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        phoneMode = PhoneMode(this, prefs)
        sensors = SensorHub(this, ::emit)
        gps = GpsHub(this, prefs, ::emit)
        signals = Signals(this, ::emit)
        speech = Speech(this, prefs, ::emit)
        applyBrightness(prefs.brightness)
        // Respect the system screen timeout: make sure nobody set keep-screen-on.
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        assets = WebViewAssetLoader.Builder()
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        WebView.setWebContentsDebuggingEnabled(debuggable)

        webView = WebView(this).apply {
            setBackgroundColor(Color.rgb(0x12, 0x11, 0x10))
            overScrollMode = View.OVER_SCROLL_NEVER
            isHapticFeedbackEnabled = false
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true // localStorage for saved pages, notes, waypoints and settings
                allowFileAccess = false // file:///android_asset still works (only used once, for the migration)
                allowContentAccess = false
                blockNetworkLoads = true // belt and braces: there is no INTERNET permission either
                setGeolocationEnabled(false) // GPS goes through the native GpsHub instead
                safeBrowsingEnabled = false // otherwise WebView may try to reach Google
                mediaPlaybackRequiresUserGesture = true
                setSupportZoom(false) // the image viewer and the map implement their own pinch-zoom
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
            if (prefs.storageMigrated) {
                webView.loadUrl(APP_URL)
            } else {
                // v1.0–1.1 ran from file:///android_asset, whose localStorage (saved pages, settings) is a different
                // origin. A tiny page on the old origin hands it over once; if that fails, carry on anyway.
                webView.loadUrl("file:///android_asset/migrate.html")
                handler.postDelayed({ if (!prefs.storageMigrated) finishMigration("{}") }, 4000)
            }
        }
    }

    fun finishMigration(json: String) {
        if (prefs.storageMigrated) return
        prefs.migratedStorage = json
        prefs.storageMigrated = true
        webView.loadUrl(APP_URL)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        webView.resumeTimers()
        sensors.resume()
        gps.resume()
        phoneMode.enterIfAllowed(this)
        emit("resume", JSONObject())
    }

    override fun onPause() {
        // Nothing runs while the guide is not visible: sensors, GPS, torch/sound patterns, speech, keep-screen-on.
        sensors.pause()
        gps.pause()
        signals.stopAll("paused")
        speech.release()
        setKeepScreenOn(false)
        emit("pause", JSONObject())
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
            // As the home launcher (or pinned) there is nothing behind us.
            intent?.hasCategory(Intent.CATEGORY_HOME) == true || phoneMode.isInLockTask() -> Unit
            else -> super.onBackPressed()
        }
    }

    override fun onDestroy() {
        sensors.stopAll()
        gps.shutdown()
        signals.release()
        speech.release()
        Torch.off(this)
        webView.destroy()
        super.onDestroy()
    }

    /** Sends an event to the web UI: window.__native(event, data). Safe to call from any thread. */
    fun emit(event: String, data: JSONObject) {
        val js = "window.__native&&window.__native(${JSONObject.quote(event)},$data)"
        if (Looper.myLooper() == Looper.getMainLooper()) {
            if (::webView.isInitialized) webView.evaluateJavascript(js, null)
        } else {
            runOnUiThread { if (::webView.isInitialized) webView.evaluateJavascript(js, null) }
        }
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

    /** The system brightness in 0..1 (for battery estimates when the app follows the system setting). */
    fun systemBrightness(): Double =
        runCatching { Settings.System.getInt(contentResolver, Settings.System.SCREEN_BRIGHTNESS) / 255.0 }.getOrDefault(-1.0)

    fun setKeepScreenOn(on: Boolean) {
        if (on) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
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
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val url = request.url
            if (url.scheme == "https" && url.host == WebViewAssetLoader.DEFAULT_DOMAIN) {
                val path = url.path ?: "/"
                if (path.startsWith("/maps/")) {
                    val range = request.requestHeaders.entries.firstOrNull { it.key.equals("Range", true) }?.value
                    return MapFiles.serve(this@MainActivity, path, range)
                }
                return assets.shouldInterceptRequest(url)
                    ?: WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), java.io.ByteArrayInputStream(ByteArray(0)))
            }
            if (url.scheme == "file") return null // android_asset (migration page only)
            // Anything else would be the network: refuse it outright.
            return WebResourceResponse("text/plain", "utf-8", 403, "Offline", emptyMap(), java.io.ByteArrayInputStream(ByteArray(0)))
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            return when {
                uri.scheme == "https" && uri.host == WebViewAssetLoader.DEFAULT_DOMAIN -> false
                uri.scheme == "file" && uri.path?.startsWith("/android_asset/") == true -> false
                else -> true // never leave the app or touch the network
            }
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // Renderer was killed (low memory). Rebuild the activity rather than crash.
            recreate()
            return true
        }
    }

    companion object {
        const val APP_URL = "https://${WebViewAssetLoader.DEFAULT_DOMAIN}/index.html"
    }
}
