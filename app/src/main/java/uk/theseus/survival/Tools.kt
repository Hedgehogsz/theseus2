package uk.theseus.survival

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.provider.MediaStore
import android.provider.Settings

/**
 * Launchers for the stock apps on the Tools screen (Samsung One UI package names first).
 * No dialler: this device has no SIM card, and UK networks do not connect SIM-less 999 calls.
 */
object Tools {
    private const val FM = "com.sec.android.app.fm"
    private const val CAMERA = "com.sec.android.app.camera"
    private const val CALCULATOR = "com.sec.android.app.popupcalculator"
    private const val SETTINGS = "com.android.settings"
    private const val CLOCK = "com.sec.android.app.clockpackage"

    /** Everything the guide may open while pinned in lock-task mode. */
    val LOCK_TASK_PACKAGES = listOf(
        FM, CAMERA, CALCULATOR, SETTINGS, CLOCK,
        "com.samsung.android.lool", "com.samsung.android.sm.devicesecurity",
    )

    fun launch(context: Context, name: String): Boolean = when (name) {
        "fm" -> openPackage(context, FM)
        "camera" -> openPackage(context, CAMERA) || start(context, Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA))
        "calculator" -> openPackage(context, CALCULATOR) ||
            start(context, Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_CALCULATOR))
        "clock" -> openPackage(context, CLOCK)
        "battery" -> start(context, Intent(Intent.ACTION_POWER_USAGE_SUMMARY)) ||
            start(context, Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS)) ||
            start(context, Intent(Settings.ACTION_SETTINGS))
        "settings" -> start(context, Intent(Settings.ACTION_SETTINGS))
        "display" -> start(context, Intent(Settings.ACTION_DISPLAY_SETTINGS))
        else -> false
    }


    private fun openPackage(context: Context, pkg: String): Boolean {
        val intent = context.packageManager.getLaunchIntentForPackage(pkg) ?: return false
        return start(context, intent)
    }

    private fun start(context: Context, intent: Intent): Boolean = try {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (e: ActivityNotFoundException) {
        false
    } catch (e: SecurityException) {
        false
    }
}
