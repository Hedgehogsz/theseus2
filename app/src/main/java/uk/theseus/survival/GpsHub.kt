package uk.theseus.survival

import android.Manifest
import android.annotation.SuppressLint
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.location.GnssStatus
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import org.json.JSONObject

/**
 * GPS for the position, map and waypoint tools. Uses android.location.LocationManager with GPS_PROVIDER directly:
 * there are no Google Play services on this phone and none are needed (GPS works in airplane mode).
 *
 * Battery rules: the receiver runs only between [start] and [stop], is stopped in [pause] (Activity.onPause), and
 * stops itself after a good fix ("fix" mode) or after a timeout. If the system location switch was off, the app
 * (as device owner) switches it on just for the session and back off afterwards.
 */
class GpsHub(
    private val context: Context,
    private val prefs: Prefs,
    private val emit: (event: String, data: JSONObject) -> Unit,
) {
    private val lm = context.getSystemService(LocationManager::class.java)
    private val dpm = context.getSystemService(DevicePolicyManager::class.java)
    private val admin = ComponentName(context, KioskAdminReceiver::class.java)
    private val handler = Handler(Looper.getMainLooper())

    /** "fix" (stop after a good fix) or "follow" (keep going until stopped); null when off. */
    var mode: String? = null
        private set
    private var paused = false
    private var startedAt = 0L
    private var deadline = 0L
    private var best: Location? = null
    private var sats = 0
    private var used = 0
    private var ttffMs = -1

    internal val listener = object : LocationListener {
        override fun onLocationChanged(loc: Location) = onFix(loc)

        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
        override fun onProviderEnabled(provider: String) = Unit
        override fun onProviderDisabled(provider: String) {
            emit("gps-status", JSONObject().put("state", "disabled"))
        }
    }

    internal val gnss = object : GnssStatus.Callback() {
        override fun onSatelliteStatusChanged(status: GnssStatus) {
            sats = status.satelliteCount
            used = (0 until status.satelliteCount).count { status.usedInFix(it) }
            progress()
        }

        override fun onFirstFix(ttffMillis: Int) {
            ttffMs = ttffMillis
        }
    }

    fun hasPermission(): Boolean =
        context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun isRunning(): Boolean = mode != null

    /** Returns "ok", "no-permission", "location-off" or "no-gps". */
    fun start(newMode: String): String {
        if (!lm.allProviders.contains(LocationManager.GPS_PROVIDER)) return "no-gps"
        if (!hasPermission()) return "no-permission"
        if (!lm.isLocationEnabled) {
            val switched = Build.VERSION.SDK_INT >= 30 && dpm.isDeviceOwnerApp(context.packageName) &&
                runCatching { dpm.setLocationEnabled(admin, true) }.isSuccess
            if (!switched) return "location-off"
            prefs.locationEnabledByUs = true
        }
        mode = newMode
        best = null
        sats = 0; used = 0; ttffMs = -1
        startedAt = SystemClock.elapsedRealtime()
        deadline = startedAt + if (newMode == "follow") FOLLOW_TIMEOUT_MS else FIX_TIMEOUT_MS
        if (!paused) register()
        return "ok"
    }

    fun stop(reason: String = "stopped") {
        if (mode == null) return
        mode = null
        unregister()
        restoreLocationSetting()
        emit("gps-stopped", JSONObject().put("reason", reason))
    }

    fun pause() {
        paused = true
        unregister()
    }

    fun resume() {
        paused = false
        if (mode != null) {
            // Fresh window after being away: a warm start is quick, but give it the full time again.
            startedAt = SystemClock.elapsedRealtime()
            deadline = startedAt + if (mode == "follow") FOLLOW_TIMEOUT_MS else FIX_TIMEOUT_MS
            register()
        }
    }

    /** The app is going away for good: stop and put the location switch back. */
    fun shutdown() {
        stop("closed")
        restoreLocationSetting()
    }

    @SuppressLint("MissingPermission")
    private fun register() {
        unregister()
        runCatching {
            lm.registerGnssStatusCallback(gnss, handler)
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, listener, Looper.getMainLooper())
        }.onFailure { emit("gps-status", JSONObject().put("state", "error").put("message", it.message ?: "")) }
        handler.postDelayed(tick, 1000)
        progress()
    }

    private fun unregister() {
        handler.removeCallbacks(tick)
        runCatching { lm.removeUpdates(listener) }
        runCatching { lm.unregisterGnssStatusCallback(gnss) }
    }

    private fun restoreLocationSetting() {
        if (prefs.locationEnabledByUs && mode == null) {
            runCatching { if (Build.VERSION.SDK_INT >= 30) dpm.setLocationEnabled(admin, false) }
            prefs.locationEnabledByUs = false
        }
    }

    private val tick = object : Runnable {
        override fun run() {
            if (mode == null || paused) return
            if (SystemClock.elapsedRealtime() >= deadline) {
                stop(if (best != null) "timeout-with-fix" else "timeout")
                return
            }
            progress()
            handler.postDelayed(this, 1000)
        }
    }

    private fun progress() {
        if (mode == null) return
        emit(
            "gps-status",
            JSONObject().put("state", if (best == null) "searching" else "fix").put("mode", mode)
                .put("sats", sats).put("used", used)
                .put("elapsed", (SystemClock.elapsedRealtime() - startedAt) / 1000)
                .put("remaining", ((deadline - SystemClock.elapsedRealtime()) / 1000).coerceAtLeast(0)),
        )
    }

    private fun onFix(loc: Location) {
        if (best == null || loc.accuracy <= best!!.accuracy + 5 || mode == "follow") best = loc
        val b = best!!
        val json = JSONObject().put("lat", b.latitude).put("lon", b.longitude).put("acc", b.accuracy.toDouble())
            .put("alt", if (b.hasAltitude()) b.altitude else JSONObject.NULL)
            .put("speed", if (b.hasSpeed()) b.speed.toDouble() else JSONObject.NULL)
            .put("time", b.time).put("sats", sats).put("used", used).put("ttff", ttffMs).put("mode", mode)
        prefs.lastFix = json.toString()
        emit("gps-fix", json)
        // "Get my position": stop as soon as the fix is good, or after it stops improving for a while.
        val age = SystemClock.elapsedRealtime() - startedAt
        if (mode == "fix" && (b.accuracy <= GOOD_ACCURACY_M || (b.accuracy <= 30 && age > 45_000))) stop("fix")
    }

    companion object {
        const val FIX_TIMEOUT_MS = 3 * 60_000L
        const val FOLLOW_TIMEOUT_MS = 30 * 60_000L
        const val GOOD_ACCURACY_M = 10f
    }
}
