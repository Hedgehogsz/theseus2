package uk.theseus.survival

import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Intent
import android.content.IntentFilter
import android.provider.Settings

/** Lock-task (kiosk) handling. Only does anything when the app is the device owner. */
class Kiosk(private val activity: MainActivity) {
    private val dpm = activity.getSystemService(DevicePolicyManager::class.java)
    private val am = activity.getSystemService(ActivityManager::class.java)
    private val admin = ComponentName(activity, KioskAdminReceiver::class.java)

    fun isDeviceOwner(): Boolean = dpm.isDeviceOwnerApp(activity.packageName)

    fun isInLockTask(): Boolean = am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE

    private fun configure() {
        dpm.setLockTaskPackages(admin, (listOf(activity.packageName) + Tools.LOCK_TASK_PACKAGES).toTypedArray())
        dpm.setLockTaskFeatures(
            admin,
            DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS or // power menu, so the phone can be switched off
                DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO or // clock and battery in the status bar
                DevicePolicyManager.LOCK_TASK_FEATURE_HOME, // Home returns to the guide from the tools
        )
        // Keep the guide as the launcher even if another home app is installed later.
        val home = IntentFilter(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            addCategory(Intent.CATEGORY_DEFAULT)
        }
        dpm.addPersistentPreferredActivity(admin, home, ComponentName(activity, MainActivity::class.java))
    }

    /** Called from onResume: pin the app if it is the device owner and kiosk mode is on. */
    fun enterIfAllowed() {
        if (!isDeviceOwner()) return
        runCatching { configure() }
        if (!activity.prefs.kioskEnabled || suspendedUntilRestart || isInLockTask()) return
        runCatching { activity.startLockTask() }
    }

    /** Hidden exit: unpin until the next reboot and open the system Settings app. */
    fun exitToSettings() {
        suspendedUntilRestart = true
        runCatching { activity.stopLockTask() }
        runCatching {
            activity.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    fun setEnabled(enabled: Boolean) {
        activity.prefs.kioskEnabled = enabled
        if (enabled) {
            suspendedUntilRestart = false
            enterIfAllowed()
        } else {
            runCatching { activity.stopLockTask() }
        }
    }

    /** Gives up device ownership entirely. After this the app is an ordinary launcher again. */
    fun removeDeviceOwner(): Boolean {
        if (!isDeviceOwner()) return false
        runCatching { activity.stopLockTask() }
        return runCatching {
            dpm.clearPackagePersistentPreferredActivities(admin, activity.packageName)
            dpm.setLockTaskPackages(admin, emptyArray())
            @Suppress("DEPRECATION")
            dpm.clearDeviceOwnerApp(activity.packageName)
        }.isSuccess
    }

    companion object {
        /** In memory only: a reboot (the phone is powered off between uses) re-enables the pin. */
        @Volatile
        var suspendedUntilRestart = false
    }
}
