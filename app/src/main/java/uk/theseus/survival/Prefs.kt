package uk.theseus.survival

import android.content.Context

/** Native-side settings. Everything else (theme, text size, favourites) lives in the WebView's localStorage. */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("settings", Context.MODE_PRIVATE)

    /** Window brightness override in 0..1, or -1 to follow the system setting. */
    var brightness: Float
        get() = sp.getFloat("brightness", -1f)
        set(value) = sp.edit().putFloat("brightness", value).apply()

    /** Whether to pin the app with lock-task mode when it is the device owner. */
    var kioskEnabled: Boolean
        get() = sp.getBoolean("kiosk_enabled", true)
        set(value) = sp.edit().putBoolean("kiosk_enabled", value).apply()
}
