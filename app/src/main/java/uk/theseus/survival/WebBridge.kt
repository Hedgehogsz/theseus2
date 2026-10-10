package uk.theseus.survival

import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.os.BatteryManager
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Exposed to the web UI as `window.Android`. Methods are called on a WebView binder thread,
 * so anything touching the window or activity is posted to the UI thread.
 */
class WebBridge(private val activity: MainActivity) {

    private fun <T> onUi(block: () -> T): T? {
        var result: T? = null
        val latch = CountDownLatch(1)
        activity.runOnUiThread {
            try {
                result = block()
            } finally {
                latch.countDown()
            }
        }
        latch.await(2, TimeUnit.SECONDS)
        return result
    }

    @JavascriptInterface
    fun getState(): String {
        val battery = activity.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val plugged = (battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0) != 0
        val temp = battery?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE) ?: Int.MIN_VALUE
        val version = activity.packageManager.getPackageInfo(activity.packageName, 0).versionName
        return JSONObject()
            .put("native", true)
            .put("version", version)
            .put("brightness", activity.prefs.brightness.toDouble())
            .put("deviceOwner", activity.kiosk.isDeviceOwner())
            .put("lockTask", activity.kiosk.isInLockTask())
            .put("kioskEnabled", activity.prefs.kioskEnabled)
            .put("kioskSuspended", Kiosk.suspendedUntilRestart)
            .put("torch", Torch.isOn)
            .put("battery", if (level >= 0 && scale > 0) level * 100 / scale else -1)
            .put("charging", plugged)
            .put("batteryTempC", if (temp == Int.MIN_VALUE) JSONObject.NULL else temp / 10.0)
            .toString()
    }

    @JavascriptInterface
    fun setBrightness(value: Float) {
        activity.prefs.brightness = value
        activity.runOnUiThread { activity.applyBrightness(value) }
    }

    @JavascriptInterface
    fun setSystemBarColor(hex: String) {
        val color = runCatching { Color.parseColor(hex) }.getOrNull() ?: return
        activity.runOnUiThread { activity.setSystemBarColor(color) }
    }

    @JavascriptInterface
    fun launchTool(name: String): Boolean = onUi { Tools.launch(activity, name) } ?: false

    @JavascriptInterface
    fun setTorch(on: Boolean): Boolean = Torch.set(activity, on)

    @JavascriptInterface
    fun exitKiosk() {
        activity.runOnUiThread { activity.kiosk.exitToSettings() }
    }

    @JavascriptInterface
    fun setKioskEnabled(enabled: Boolean) {
        activity.runOnUiThread { activity.kiosk.setEnabled(enabled) }
    }

    @JavascriptInterface
    fun removeDeviceOwner(): Boolean = onUi { activity.kiosk.removeDeviceOwner() } ?: false
}
