package uk.theseus.survival

import android.content.Context

/** Native-side settings. Everything else (theme, text size, saved pages, notes) lives in the WebView's localStorage. */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("settings", Context.MODE_PRIVATE)

    /** Window brightness override in 0..1, or -1 to follow the system setting. */
    var brightness: Float
        get() = sp.getFloat("brightness", -1f)
        set(value) = sp.edit().putFloat("brightness", value).apply()

    /**
     * Phone mode: [PhoneMode.SURVIVAL] (guide is the pinned home screen) or [PhoneMode.NORMAL] (Samsung launcher is
     * home, the guide is an ordinary app). Null until first chosen: v1.2 then defaults to survival when device owner.
     */
    var mode: String?
        get() = sp.getString("phone_mode", null)
        set(value) = sp.edit().putString("phone_mode", value).apply()

    /** v1.1's "pin the app" switch. Only read once, to carry an explicit "off" over into the new modes. */
    val legacyKioskEnabled: Boolean
        get() = sp.getBoolean("kiosk_enabled", true)

    /** localStorage moved from the file:// origin (v1.0–1.1) to https://appassets.androidplatform.net (v1.2+). */
    var storageMigrated: Boolean
        get() = sp.getBoolean("storage_migrated", false)
        set(value) = sp.edit().putBoolean("storage_migrated", value).apply()

    /** The old origin's localStorage as JSON, handed to the new origin once and then cleared. */
    var migratedStorage: String?
        get() = sp.getString("migrated_storage", null)
        set(value) = sp.edit().putString("migrated_storage", value).apply()

    /** Last GPS fix, for the sun tool and the map's starting view. */
    var lastFix: String?
        get() = sp.getString("last_fix", null)
        set(value) = sp.edit().putString("last_fix", value).apply()

    /** Whether we switched the system location setting on (so we switch it off again afterwards). */
    var locationEnabledByUs: Boolean
        get() = sp.getBoolean("location_by_us", false)
        set(value) = sp.edit().putBoolean("location_by_us", value).apply()

    /** Cached result of the last text-to-speech check: 1 offline voice available, 0 not, -1 unknown. */
    var ttsAvailable: Int
        get() = sp.getInt("tts_available", -1)
        set(value) = sp.edit().putInt("tts_available", value).apply()
}
