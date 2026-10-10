package uk.theseus.survival

import android.Manifest
import android.app.Activity
import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import org.json.JSONObject

/**
 * "Phone mode": switches the phone between
 *  - SURVIVAL: the guide is the home screen (a persistent preferred HOME activity set as device owner, so it wins
 *    even when Samsung's launcher is enabled) and the app is pinned with lock-task mode;
 *  - NORMAL: Samsung's launcher is home again and the guide is an ordinary app. Device ownership is kept quietly, so
 *    going back to survival mode is one tap with no PC.
 * The mode is saved and re-applied on every start and on boot ([BootReceiver]). Nothing here does anything unless
 * the app is the device owner.
 */
class PhoneMode(private val context: Context, private val prefs: Prefs) {
    private val dpm = context.getSystemService(DevicePolicyManager::class.java)
    private val am = context.getSystemService(ActivityManager::class.java)
    private val pm = context.packageManager
    private val admin = ComponentName(context, KioskAdminReceiver::class.java)
    private val ours = ComponentName(context, MainActivity::class.java)

    fun isDeviceOwner(): Boolean = dpm.isDeviceOwnerApp(context.packageName)

    fun isInLockTask(): Boolean = am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE

    /** The saved mode; survival until the user chooses (v1.0–1.1 behaved that way). */
    val mode: String
        get() = prefs.mode ?: SURVIVAL

    private fun homeFilter() = IntentFilter(Intent.ACTION_MAIN).apply {
        addCategory(Intent.CATEGORY_HOME)
        addCategory(Intent.CATEGORY_DEFAULT)
    }

    private fun homeIntent() = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)

    /** Another installed, enabled home app (Samsung's launcher preferred), or null if the guide is the only one. */
    fun otherHome(): ComponentName? {
        val all = pm.queryIntentActivities(homeIntent(), PackageManager.MATCH_DEFAULT_ONLY)
            .map { ComponentName(it.activityInfo.packageName, it.activityInfo.name) }
            .filter { it.packageName != context.packageName && it.packageName != "com.android.settings" }
        return all.firstOrNull { it.packageName == SAMSUNG_LAUNCHER } ?: all.firstOrNull()
    }

    /** "ok", "disabled" (pm disable-user), "uninstalled" (pm uninstall --user 0) or "missing". */
    fun samsungLauncherState(): String = try {
        @Suppress("DEPRECATION")
        val info = pm.getApplicationInfo(
            SAMSUNG_LAUNCHER,
            PackageManager.MATCH_UNINSTALLED_PACKAGES or PackageManager.MATCH_DISABLED_COMPONENTS,
        )
        when {
            info.flags and ApplicationInfo.FLAG_INSTALLED == 0 -> "uninstalled"
            !info.enabled -> "disabled"
            else -> "ok"
        }
    } catch (e: PackageManager.NameNotFoundException) {
        "missing"
    }

    /** Which app the Home button opens right now. */
    fun currentHome(): String {
        val ri = pm.resolveActivity(homeIntent(), PackageManager.MATCH_DEFAULT_ONLY) ?: return "none"
        return when (val p = ri.activityInfo.packageName) {
            context.packageName -> "guide"
            SAMSUNG_LAUNCHER -> "samsung"
            "android" -> "ask" // the "choose a home app" resolver
            else -> p
        }
    }

    /**
     * Applies the saved mode's device policies: lock-task allow-list, runtime permissions for the tools, and which
     * activity answers HOME. Safe to call repeatedly (onResume, boot).
     */
    fun applyPolicies(): Boolean {
        if (!isDeviceOwner()) return false
        if (prefs.mode == null) prefs.mode = if (prefs.legacyKioskEnabled) SURVIVAL else NORMAL
        runCatching {
            dpm.setLockTaskPackages(admin, (listOf(context.packageName) + Tools.LOCK_TASK_PACKAGES).toTypedArray())
            dpm.setLockTaskFeatures(
                admin,
                DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS or // power menu, so the phone can be switched off
                    DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO or // clock and battery in the status bar
                    DevicePolicyManager.LOCK_TASK_FEATURE_HOME, // Home returns to the guide from the tools
            )
        }
        grantToolPermissions()
        return if (mode == NORMAL) homeToOther() else homeToGuide()
    }

    private fun homeToGuide(): Boolean = runCatching {
        // Remove any HOME preference we gave another launcher, then make the guide win HOME outright. This doesn't
        // rely on Samsung's launcher being disabled: a persistent preferred activity beats every other home app.
        otherHome()?.let { dpm.clearPackagePersistentPreferredActivities(admin, it.packageName) }
        dpm.clearPackagePersistentPreferredActivities(admin, SAMSUNG_LAUNCHER)
        dpm.addPersistentPreferredActivity(admin, homeFilter(), ours)
    }.isSuccess

    private fun homeToOther(): Boolean {
        if (samsungLauncherState() == "uninstalled") runCatching { dpm.enableSystemApp(admin, SAMSUNG_LAUNCHER) }
        val other = otherHome() ?: return false
        return runCatching {
            dpm.clearPackagePersistentPreferredActivities(admin, context.packageName)
            // Point HOME at the other launcher explicitly, so the phone never shows "choose a home app".
            dpm.addPersistentPreferredActivity(admin, homeFilter(), other)
        }.isSuccess
    }

    /** Device owner can grant the tools' runtime permissions itself, so no dialogs appear in lock-task mode. */
    private fun grantToolPermissions() {
        val perms = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        if (Build.VERSION.SDK_INT >= 29) perms += Manifest.permission.ACTIVITY_RECOGNITION
        for (p in perms) {
            if (context.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED) continue
            runCatching {
                dpm.setPermissionGrantState(admin, context.packageName, p, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)
            }
        }
    }

    /** Called from the activity's onResume. */
    fun enterIfAllowed(activity: Activity) {
        if (!isDeviceOwner()) return
        if (!appliedThisProcess) {
            applyPolicies()
            appliedThisProcess = true
        }
        if (mode != SURVIVAL || suspendedUntilRestart || isInLockTask()) return
        runCatching { activity.startLockTask() }
    }

    /** Result: "ok", "not-owner" or "no-other-home". */
    fun setMode(activity: Activity, newMode: String): String {
        if (!isDeviceOwner()) return "not-owner"
        if (newMode == NORMAL) {
            if (samsungLauncherState() == "uninstalled") runCatching { dpm.enableSystemApp(admin, SAMSUNG_LAUNCHER) }
            if (otherHome() == null) return "no-other-home"
        }
        prefs.mode = newMode
        applyPolicies()
        if (newMode == SURVIVAL) {
            suspendedUntilRestart = false
            if (!isInLockTask()) runCatching { activity.startLockTask() }
        } else {
            runCatching { activity.stopLockTask() }
        }
        return "ok"
    }

    /** Hidden exit: unpin until the next reboot and open the system Settings app. */
    fun exitToSettings(activity: Activity) {
        suspendedUntilRestart = true
        runCatching { activity.stopLockTask() }
        runCatching {
            activity.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    /**
     * Re-installs every system app that was removed for this user with `pm uninstall --user 0` (Google Play, YouTube,
     * Samsung apps...). Runs on the calling (background) thread and reports progress.
     */
    fun restoreAllApps(progress: (done: Int, total: Int, pkg: String) -> Unit): JSONObject {
        if (!isDeviceOwner()) return JSONObject().put("ok", false).put("error", "not-owner")
        @Suppress("DEPRECATION")
        val removed = pm.getInstalledPackages(PackageManager.MATCH_UNINSTALLED_PACKAGES)
            .mapNotNull { it.applicationInfo }
            .filter { it.flags and ApplicationInfo.FLAG_SYSTEM != 0 && it.flags and ApplicationInfo.FLAG_INSTALLED == 0 }
            .map { it.packageName }
            .filter { it != context.packageName }
            .sorted()
        var restored = 0
        val failed = mutableListOf<String>()
        removed.forEachIndexed { i, pkg ->
            if (runCatching { dpm.enableSystemApp(admin, pkg) }.isSuccess) restored++ else failed += pkg
            progress(i + 1, removed.size, pkg)
        }
        return JSONObject().put("ok", true).put("total", removed.size).put("restored", restored)
            .put("failed", org.json.JSONArray(failed))
    }

    /** Gives up device ownership entirely. Getting it back needs a PC with adb. */
    fun removeDeviceOwner(activity: Activity): Boolean {
        if (!isDeviceOwner()) return false
        runCatching { activity.stopLockTask() }
        return runCatching {
            dpm.clearPackagePersistentPreferredActivities(admin, context.packageName)
            otherHome()?.let { dpm.clearPackagePersistentPreferredActivities(admin, it.packageName) }
            dpm.setLockTaskPackages(admin, emptyArray())
            @Suppress("DEPRECATION")
            dpm.clearDeviceOwnerApp(context.packageName)
        }.isSuccess
    }

    fun status(): JSONObject = JSONObject()
        .put("owner", isDeviceOwner())
        .put("mode", if (prefs.mode == null && !isDeviceOwner()) "none" else mode)
        .put("pinned", isInLockTask())
        .put("suspended", suspendedUntilRestart)
        .put("home", currentHome())
        .put("otherHome", otherHome()?.packageName ?: JSONObject.NULL)
        .put("samsungLauncher", samsungLauncherState())
        .put("restoreCommand", "adb shell dpm set-device-owner ${context.packageName}/.KioskAdminReceiver")

    companion object {
        const val SURVIVAL = "survival"
        const val NORMAL = "normal"
        const val SAMSUNG_LAUNCHER = "com.sec.android.app.launcher"

        /** In memory only: a reboot (the phone is powered off between uses) re-enables the pin. */
        @Volatile
        var suspendedUntilRestart = false

        @Volatile
        private var appliedThisProcess = false
    }
}
