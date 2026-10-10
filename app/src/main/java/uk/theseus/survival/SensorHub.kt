package uk.theseus.survival

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * On-demand sensors for the tool screens: "compass", "level" and "steps".
 *
 * Battery rules: a sensor is registered only after its tool screen asks for it, always at SENSOR_DELAY_UI or slower,
 * stopped when the screen is left, unregistered in [pause] (Activity.onPause) and re-registered in [resume] only if
 * the screen still wants it, and stopped automatically after a timeout. Values are low-pass filtered and pushed to
 * the WebView at most [PUSH_MS] apart.
 */
class SensorHub(context: Context, private val emit: (event: String, data: JSONObject) -> Unit) {
    private val sm = context.getSystemService(SensorManager::class.java)
    private val handler = Handler(Looper.getMainLooper())

    /** Sensors the visible tool screen asked for, with their auto-stop deadlines (elapsed realtime). */
    private val wanted = linkedMapOf<String, Long>()
    private var paused = false

    // The listener is kept as one object so tests (and onPause) can check it is gone from the SensorManager.
    internal val listener = Listener()

    fun available(): JSONObject = JSONObject()
        .put("rotationVector", sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR) != null)
        .put("magnetometer", sm.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD) != null)
        .put("accelerometer", sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null)
        .put("gravity", sm.getDefaultSensor(Sensor.TYPE_GRAVITY) != null)
        .put("stepCounter", sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null)
        .put("barometer", sm.getDefaultSensor(Sensor.TYPE_PRESSURE) != null)

    fun active(): Set<String> = wanted.keys.toSet()

    /** Starts [name] for at most [timeoutMs]; returns false if the phone lacks the sensor. */
    fun start(name: String, timeoutMs: Long): Boolean {
        if (sensorsFor(name).isEmpty()) return false
        wanted[name] = SystemClock.elapsedRealtime() + timeoutMs
        if (name == "steps") stepBase = -1f
        if (!paused) register(name)
        scheduleTimeout()
        return true
    }

    fun stop(name: String) {
        if (wanted.remove(name) != null) {
            unregisterAll()
            if (!paused) wanted.keys.forEach { register(it) }
            emit("sensor-stopped", JSONObject().put("name", name).put("reason", "stopped"))
        }
        scheduleTimeout()
    }

    fun stopAll() {
        val names = wanted.keys.toList()
        wanted.clear()
        unregisterAll()
        handler.removeCallbacksAndMessages(null)
        names.forEach { emit("sensor-stopped", JSONObject().put("name", it).put("reason", "stopped")) }
    }

    /** Activity.onPause: nothing keeps running while the guide isn't on screen. */
    fun pause() {
        paused = true
        unregisterAll()
        handler.removeCallbacksAndMessages(null)
    }

    /** Activity.onResume: the screen is visible again, so restart what it had asked for (with a fresh timeout). */
    fun resume() {
        paused = false
        val now = SystemClock.elapsedRealtime()
        for (k in wanted.keys) wanted[k] = maxOf(wanted.getValue(k), now + RESUME_GRACE_MS)
        wanted.keys.forEach { register(it) }
        scheduleTimeout()
    }

    private fun sensorsFor(name: String): List<Sensor> = when (name) {
        "compass" -> {
            val rv = sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
            val mag = sm.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)
            val acc = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
            // Tilt-compensated rotation vector (fused accel + mag + gyro); fall back to accelerometer + magnetometer.
            // The magnetometer is also registered with the rotation vector for its calibration-accuracy reports.
            when {
                rv != null -> listOfNotNull(rv, mag)
                mag != null && acc != null -> listOf(acc, mag)
                else -> emptyList()
            }
        }
        "level" -> listOfNotNull(sm.getDefaultSensor(Sensor.TYPE_GRAVITY) ?: sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER))
        "steps" -> listOfNotNull(sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER))
        else -> emptyList()
    }

    private fun register(name: String) {
        for (s in sensorsFor(name)) {
            // Step counts are batched in the sensor hub, so the CPU isn't woken for every step.
            val latency = if (s.type == Sensor.TYPE_STEP_COUNTER) 5_000_000 else 0
            sm.registerListener(listener, s, SensorManager.SENSOR_DELAY_UI, latency)
        }
    }

    private fun unregisterAll() {
        sm.unregisterListener(listener)
    }

    private fun scheduleTimeout() {
        handler.removeCallbacksAndMessages(null)
        if (paused || wanted.isEmpty()) return
        val next = wanted.values.minOrNull() ?: return
        handler.postAtTime({ expire() }, next)
    }

    private fun expire() {
        val now = SystemClock.elapsedRealtime()
        val gone = wanted.filterValues { it <= now }.keys.toList()
        if (gone.isNotEmpty()) {
            gone.forEach { wanted.remove(it) }
            unregisterAll()
            if (!paused) wanted.keys.forEach { register(it) }
            gone.forEach { emit("sensor-stopped", JSONObject().put("name", it).put("reason", "timeout")) }
        }
        scheduleTimeout()
    }

    // --- sensor maths -----------------------------------------------------------------------------------------

    private val rot = FloatArray(9)
    private val remapped = FloatArray(9)
    private val orient = FloatArray(3)
    private val gravity = FloatArray(3)
    private val geomag = FloatArray(3)
    private var haveAcc = false
    private var haveMag = false
    private var magAccuracy = SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM
    private var smoothSin = Double.NaN
    private var smoothCos = 0.0
    private var lastCompassPush = 0L
    private var lastLevelPush = 0L
    private var lastStepsPush = 0L
    private var stepBase = -1f
    private var levelPitch = Double.NaN
    private var levelRoll = 0.0

    private fun pushCompass(azimuthRad: Double, pitchDeg: Double, rollDeg: Double, src: String, accRad: Float) {
        // Low-pass filter on the unit vector, so 359° -> 1° doesn't swing through 180°.
        val a = 0.25
        if (smoothSin.isNaN()) {
            smoothSin = sin(azimuthRad); smoothCos = cos(azimuthRad)
        } else {
            smoothSin += a * (sin(azimuthRad) - smoothSin)
            smoothCos += a * (cos(azimuthRad) - smoothCos)
        }
        val now = SystemClock.elapsedRealtime()
        if (now - lastCompassPush < PUSH_MS) return
        lastCompassPush = now
        var deg = Math.toDegrees(atan2(smoothSin, smoothCos))
        if (deg < 0) deg += 360.0
        emit(
            "compass",
            JSONObject().put("az", round1(deg)).put("pitch", round1(pitchDeg)).put("roll", round1(rollDeg))
                .put("acc", magAccuracy).put("src", src)
                .put("err", if (accRad > 0) round1(Math.toDegrees(accRad.toDouble())) else JSONObject.NULL),
        )
    }

    private fun azimuthFrom(r: FloatArray, src: String, accRad: Float) {
        // Phone flat: azimuth of the top edge. Held upright (screen facing you): remap so the camera's view direction
        // is used, which stays stable as you lift the phone to sight a landmark.
        SensorManager.getOrientation(r, orient)
        val pitch = Math.toDegrees(orient[1].toDouble())
        val roll = Math.toDegrees(orient[2].toDouble())
        if (abs(pitch) > 50) {
            SensorManager.remapCoordinateSystem(r, SensorManager.AXIS_X, SensorManager.AXIS_Z, remapped)
            SensorManager.getOrientation(remapped, orient)
        }
        pushCompass(orient[0].toDouble(), pitch, roll, src, accRad)
    }

    inner class Listener : SensorEventListener {
        override fun onSensorChanged(e: SensorEvent) {
            when (e.sensor.type) {
                Sensor.TYPE_ROTATION_VECTOR -> {
                    SensorManager.getRotationMatrixFromVector(rot, e.values)
                    azimuthFrom(rot, "rv", if (e.values.size > 4) e.values[4] else -1f)
                }
                Sensor.TYPE_MAGNETIC_FIELD -> {
                    System.arraycopy(e.values, 0, geomag, 0, 3); haveMag = true
                    if (sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR) == null) fallbackCompass()
                }
                Sensor.TYPE_ACCELEROMETER -> {
                    for (i in 0..2) gravity[i] = gravity[i] + 0.2f * (e.values[i] - gravity[i])
                    haveAcc = true
                    if ("level" in wanted && sm.getDefaultSensor(Sensor.TYPE_GRAVITY) == null) level(gravity)
                    if ("compass" in wanted && sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR) == null) fallbackCompass()
                }
                Sensor.TYPE_GRAVITY -> level(e.values)
                Sensor.TYPE_STEP_COUNTER -> steps(e.values[0])
            }
        }

        override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {
            if (sensor.type == Sensor.TYPE_MAGNETIC_FIELD) {
                magAccuracy = accuracy
                emit("compass-accuracy", JSONObject().put("acc", accuracy))
            }
        }
    }

    private fun fallbackCompass() {
        if (!haveAcc || !haveMag) return
        if (SensorManager.getRotationMatrix(rot, null, gravity, geomag)) azimuthFrom(rot, "am", -1f)
    }

    private fun level(g: FloatArray) {
        // Pitch: tilt of the long edge from horizontal (for slope and sighting heights along the phone's top edge).
        // Roll: tilt of the short edge. Both in degrees.
        val norm = sqrt((g[0] * g[0] + g[1] * g[1] + g[2] * g[2]).toDouble())
        if (norm < 1e-3) return
        val pitch = Math.toDegrees(atan2(g[1].toDouble(), sqrt((g[0] * g[0] + g[2] * g[2]).toDouble())))
        val roll = Math.toDegrees(atan2(-g[0].toDouble(), sqrt((g[1] * g[1] + g[2] * g[2]).toDouble())))
        if (levelPitch.isNaN()) { levelPitch = pitch; levelRoll = roll } else {
            levelPitch += 0.3 * (pitch - levelPitch); levelRoll += 0.3 * (roll - levelRoll)
        }
        val now = SystemClock.elapsedRealtime()
        if (now - lastLevelPush < PUSH_MS) return
        lastLevelPush = now
        emit("level", JSONObject().put("pitch", round1(levelPitch)).put("roll", round1(levelRoll))
            .put("flat", round1(Math.toDegrees(Math.acos((g[2] / norm).coerceIn(-1.0, 1.0))))))
    }

    private fun steps(total: Float) {
        if (stepBase < 0) stepBase = total
        val now = SystemClock.elapsedRealtime()
        if (now - lastStepsPush < 1000) return
        lastStepsPush = now
        emit("steps", JSONObject().put("total", total.toLong()).put("since", (total - stepBase).toLong()))
    }

    private fun round1(v: Double) = Math.round(v * 10) / 10.0

    companion object {
        const val PUSH_MS = 120L
        const val RESUME_GRACE_MS = 60_000L
    }
}
