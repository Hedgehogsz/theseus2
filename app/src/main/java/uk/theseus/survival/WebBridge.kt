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
 * Exposed to the web UI as `window.Android`. Methods are called on a WebView binder thread, so anything touching the
 * window, sensors or activity is posted to the UI thread. Results that arrive later (sensor values, GPS fixes,
 * progress) come back as `window.__native(event, data)` calls (see [MainActivity.emit]).
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
        latch.await(3, TimeUnit.SECONDS)
        return result
    }

    @JavascriptInterface
    fun getState(): String {
        val battery = activity.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val plugged = (battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0) != 0
        val temp = battery?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE) ?: Int.MIN_VALUE
        val bm = activity.getSystemService(BatteryManager::class.java)
        val chargeUah = runCatching { bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER) }.getOrDefault(-1)
        val version = activity.packageManager.getPackageInfo(activity.packageName, 0).versionName
        return JSONObject()
            .put("native", true)
            .put("version", version)
            .put("brightness", activity.prefs.brightness.toDouble())
            .put("systemBrightness", activity.systemBrightness())
            .put("deviceOwner", activity.phoneMode.isDeviceOwner())
            .put("lockTask", activity.phoneMode.isInLockTask())
            .put("mode", activity.phoneMode.mode)
            .put("kioskSuspended", PhoneMode.suspendedUntilRestart)
            .put("torch", Torch.isOn)
            .put("battery", if (level >= 0 && scale > 0) level * 100 / scale else -1)
            .put("charging", plugged)
            .put("chargeMah", if (chargeUah > 0) chargeUah / 1000 else -1)
            .put("batteryTempC", if (temp == Int.MIN_VALUE) JSONObject.NULL else temp / 10.0)
            .put("tts", activity.prefs.ttsAvailable)
            .put("lastFix", activity.prefs.lastFix?.let { JSONObject(it) } ?: JSONObject.NULL)
            .toString()
    }

    // --- display -------------------------------------------------------------------------------------------------

    @JavascriptInterface
    fun setBrightness(value: Float) {
        activity.prefs.brightness = value
        activity.runOnUiThread { activity.applyBrightness(value) }
    }

    /** Temporary brightness for signalling (not saved); a negative value restores the saved setting. */
    @JavascriptInterface
    fun setSignalBrightness(value: Float) {
        activity.runOnUiThread { activity.applyBrightness(if (value < 0) activity.prefs.brightness else value) }
    }

    /** Only while a signal or metronome is running; cleared automatically in onPause. */
    @JavascriptInterface
    fun keepScreenOn(on: Boolean) {
        activity.runOnUiThread { activity.setKeepScreenOn(on) }
    }

    @JavascriptInterface
    fun setSystemBarColor(hex: String) {
        val color = runCatching { Color.parseColor(hex) }.getOrNull() ?: return
        activity.runOnUiThread { activity.setSystemBarColor(color) }
    }

    // --- phone apps -----------------------------------------------------------------------------------------------

    @JavascriptInterface
    fun launchTool(name: String): Boolean = onUi { Tools.launch(activity, name) } ?: false

    @JavascriptInterface
    fun toolsAvailable(): String = Tools.available(activity).toString()

    @JavascriptInterface
    fun setTorch(on: Boolean): Boolean {
        onUi { activity.signals.stop("torch") }
        return Torch.set(activity, on)
    }

    // --- sensors and GPS ------------------------------------------------------------------------------------------

    @JavascriptInterface
    fun sensorsAvailable(): String = onUi { activity.sensors.available().toString() } ?: "{}"

    @JavascriptInterface
    fun startSensor(name: String, timeoutMs: Long): Boolean = onUi { activity.sensors.start(name, timeoutMs) } ?: false

    @JavascriptInterface
    fun stopSensor(name: String) {
        activity.runOnUiThread { activity.sensors.stop(name) }
    }

    @JavascriptInterface
    fun startGps(mode: String): String = onUi { activity.gps.start(mode) } ?: "error"

    @JavascriptInterface
    fun stopGps() {
        activity.runOnUiThread { activity.gps.stop() }
    }

    // --- signals --------------------------------------------------------------------------------------------------

    /** [patternJson]: JSON array of on/off durations in ms, starting with "on". */
    @JavascriptInterface
    fun startPattern(channel: String, patternJson: String, repeat: Boolean, freq: Int, loud: Boolean, maxMs: Long): Boolean =
        onUi { activity.signals.start(channel, Signals.parsePattern(patternJson), repeat, freq, loud, maxMs) } ?: false

    @JavascriptInterface
    fun stopPattern(channel: String) {
        activity.runOnUiThread { activity.signals.stop(channel) }
    }

    // --- read aloud -----------------------------------------------------------------------------------------------

    @JavascriptInterface
    fun ttsCheck() {
        activity.runOnUiThread { activity.speech.check() }
    }

    @JavascriptInterface
    fun ttsSpeak(text: String) {
        activity.runOnUiThread { activity.speech.speak(text) }
    }

    @JavascriptInterface
    fun ttsStop() {
        activity.runOnUiThread { activity.speech.stop() }
    }

    // --- map ------------------------------------------------------------------------------------------------------

    @JavascriptInterface
    fun mapStatus(): String = MapFiles.status(activity).toString()

    // --- storage migration (v1.1 -> v1.2 origin change) -----------------------------------------------------------

    @JavascriptInterface
    fun migrateStorage(json: String) {
        activity.runOnUiThread { activity.finishMigration(json) }
    }

    /** The old origin's saved data, once; null afterwards. */
    @JavascriptInterface
    fun takeMigratedStorage(): String? {
        val s = activity.prefs.migratedStorage
        if (s != null) activity.prefs.migratedStorage = null
        return s
    }

    // --- phone mode -----------------------------------------------------------------------------------------------

    @JavascriptInterface
    fun phoneModeStatus(): String = onUi { activity.phoneMode.status().toString() } ?: "{}"

    @JavascriptInterface
    fun setPhoneMode(mode: String): String = onUi { activity.phoneMode.setMode(activity, mode) } ?: "error"

    /** Runs in the background; progress arrives as "restore-progress" and the result as "restore-done". */
    @JavascriptInterface
    fun restoreAllApps() {
        Thread {
            val result = activity.phoneMode.restoreAllApps { done, total, pkg ->
                activity.emit("restore-progress", JSONObject().put("done", done).put("total", total).put("pkg", pkg))
            }
            activity.emit("restore-done", result)
        }.start()
    }

    @JavascriptInterface
    fun exitKiosk() {
        activity.runOnUiThread { activity.phoneMode.exitToSettings(activity) }
    }

    @JavascriptInterface
    fun removeDeviceOwner(): Boolean = onUi { activity.phoneMode.removeDeviceOwner(activity) } ?: false
}
