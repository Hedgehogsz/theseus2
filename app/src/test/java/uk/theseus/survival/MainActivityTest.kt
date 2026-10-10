package uk.theseus.survival

import android.content.Intent
import android.view.ViewGroup
import android.webkit.WebView
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31]) // Android 12, as on the Galaxy A21s
class MainActivityTest {

    private fun launch(): Pair<MainActivity, WebView> {
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        val content = activity.findViewById<ViewGroup>(android.R.id.content)
        return activity to content.getChildAt(0) as WebView
    }

    @Test
    fun loadsLocalUiWithNetworkBlocked() {
        val (_, webView) = launch()
        assertEquals("file:///android_asset/index.html", shadowOf(webView).lastLoadedUrl)
        assertTrue(webView.settings.blockNetworkLoads)
        assertTrue(webView.settings.javaScriptEnabled)
        assertTrue(webView.settings.domStorageEnabled)
        assertFalse(webView.settings.offscreenPreRaster)
    }

    @Test
    fun doesNotKeepScreenOn() {
        val (activity, _) = launch()
        val flags = activity.window.attributes.flags
        assertEquals(0, flags and android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    @Test
    fun isAHomeLauncher() {
        val (activity, _) = launch()
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setPackage(activity.packageName)
        val matches = activity.packageManager.queryIntentActivities(home, 0)
        assertTrue(matches.any { it.activityInfo.name == MainActivity::class.java.name })
    }

    @Test
    fun bundledUiAndContentArePresent() {
        val (activity, _) = launch()
        for (path in listOf("index.html", "app.js", "app.css", "icons.js", "fonts.css", "content/index.json", "content/index.js")) {
            activity.assets.open(path).use { assertTrue("$path is empty", it.read() >= 0) }
        }
    }

    @Test
    fun bridgeReportsState() {
        val (activity, _) = launch()
        val state = JSONObject(WebBridge(activity).getState())
        assertTrue(state.getBoolean("native"))
        assertFalse(state.getBoolean("deviceOwner"))
        assertTrue(state.getBoolean("kioskEnabled"))
    }

    @Test
    fun cannotCallOrText() {
        // The phone has no SIM: nothing in the bridge may dial, call or text.
        val names = WebBridge::class.java.methods.map { it.name.lowercase() }
        assertFalse(names.toString(), names.any { "dial" in it || "call" in it || "sms" in it })
        val (activity, _) = launch()
        assertFalse(Tools.launch(activity, "dialer"))
    }

    @Test
    fun brightnessOverrideIsPersisted() {
        val (activity, _) = launch()
        WebBridge(activity).setBrightness(0.1f)
        shadowOf(android.os.Looper.getMainLooper()).idle()
        assertEquals(0.1f, activity.prefs.brightness, 0.0001f)
        assertEquals(0.1f, activity.window.attributes.screenBrightness, 0.0001f)
    }
}
