package uk.theseus.survival

import android.Manifest
import android.app.Application
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Intent
import android.content.IntentFilter
import android.hardware.Sensor
import android.hardware.SensorManager
import android.location.LocationManager
import android.os.Looper
import android.view.ViewGroup
import android.webkit.WebView
import org.robolectric.RuntimeEnvironment
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowSensor
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31]) // Android 12, as on the Galaxy A21s
class NativeToolsTest {
    private lateinit var app: Application

    @Before
    fun setUp() {
        app = RuntimeEnvironment.getApplication()
        val sm = app.getSystemService(SensorManager::class.java)
        for (type in listOf(Sensor.TYPE_ROTATION_VECTOR, Sensor.TYPE_MAGNETIC_FIELD, Sensor.TYPE_ACCELEROMETER,
            Sensor.TYPE_GRAVITY, Sensor.TYPE_STEP_COUNTER)) {
            shadowOf(sm).addSensor(ShadowSensor.newInstance(type))
        }
        shadowOf(app).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        val lm = app.getSystemService(LocationManager::class.java)
        shadowOf(lm).setLocationEnabled(true)
        shadowOf(lm).setProviderEnabled(LocationManager.GPS_PROVIDER, true)
    }

    private fun controller(): ActivityController<MainActivity> = Robolectric.buildActivity(MainActivity::class.java).setup()

    @Test
    fun everySensorAndGpsListenerIsUnregisteredInOnPause() {
        val c = controller()
        val a = c.get()
        val sm = shadowOf(app.getSystemService(SensorManager::class.java))
        val lm = shadowOf(app.getSystemService(LocationManager::class.java))

        assertTrue(a.sensors.start("compass", 60_000))
        assertTrue(a.sensors.start("level", 60_000))
        assertTrue(a.sensors.start("steps", 60_000))
        assertEquals("ok", a.gps.start("follow"))
        assertTrue(sm.hasListener(a.sensors.listener))
        assertTrue(lm.getLocationUpdateListeners().contains(a.gps.listener))

        c.pause()
        assertFalse("sensor listener still registered after onPause", sm.hasListener(a.sensors.listener))
        assertTrue("sensor listeners left after onPause: ${sm.listeners}", sm.listeners.isEmpty())
        assertFalse("GPS still running after onPause", lm.getLocationUpdateListeners().contains(a.gps.listener))

        // Coming back to the same tool screen restarts only what it asked for.
        c.resume()
        assertTrue(sm.hasListener(a.sensors.listener))
        assertTrue(lm.getLocationUpdateListeners().contains(a.gps.listener))

        // Leaving the tool screens stops everything.
        a.sensors.stopAll()
        a.gps.stop()
        assertTrue(sm.listeners.isEmpty())
        assertFalse(lm.getLocationUpdateListeners().contains(a.gps.listener))
    }

    @Test
    fun sensorsStopThemselvesAfterTheirTimeout() {
        val a = controller().get()
        val sm = shadowOf(app.getSystemService(SensorManager::class.java))
        assertTrue(a.sensors.start("compass", 1_000))
        assertTrue(sm.hasListener(a.sensors.listener))
        shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofSeconds(2))
        assertFalse(sm.hasListener(a.sensors.listener))
        assertTrue(a.sensors.active().isEmpty())
    }

    @Test
    fun gpsStopsAfterAGoodFix() {
        val a = controller().get()
        val lm = app.getSystemService(LocationManager::class.java)
        assertEquals("ok", a.gps.start("fix"))
        val loc = android.location.Location(LocationManager.GPS_PROVIDER).apply {
            latitude = 54.6; longitude = -3.1; accuracy = 6f; time = System.currentTimeMillis()
            elapsedRealtimeNanos = android.os.SystemClock.elapsedRealtimeNanos()
        }
        shadowOf(lm).simulateLocation(loc)
        shadowOf(Looper.getMainLooper()).idle()
        assertFalse(a.gps.isRunning())
        assertFalse(shadowOf(lm).getLocationUpdateListeners().contains(a.gps.listener))
        assertTrue(a.prefs.lastFix!!.contains("54.6"))
    }

    @Test
    fun signalsStopInOnPause() {
        val c = controller()
        val a = c.get()
        assertTrue(a.signals.start("sound", longArrayOf(200, 300), true, 2900, false, 60_000))
        assertTrue(a.signals.isRunning("sound"))
        c.pause()
        assertFalse(a.signals.isRunning("sound"))
    }

    @Test
    fun survivalModeMakesTheGuideHomeAndNormalModeHandsHomeToSamsung() {
        val a = controller().get()
        val dpm = app.getSystemService(DevicePolicyManager::class.java)
        val admin = ComponentName(app, KioskAdminReceiver::class.java)
        shadowOf(dpm).setDeviceOwner(admin)

        // Samsung's launcher, re-enabled with `pm enable`, is a second home app.
        val samsung = ComponentName(PhoneMode.SAMSUNG_LAUNCHER, "com.android.launcher3.uioverrides.QuickstepLauncher")
        val spm = shadowOf(app.packageManager)
        spm.addActivityIfNotPresent(samsung)
        spm.addIntentFilterForActivity(samsung, IntentFilter(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME); addCategory(Intent.CATEGORY_DEFAULT)
        })

        assertTrue(a.phoneMode.applyPolicies())
        assertEquals(PhoneMode.SURVIVAL, a.prefs.mode) // first run after the update defaults to survival
        assertEquals(listOf(ComponentName(app, MainActivity::class.java)), persistentHome(a.packageName))

        assertEquals("ok", a.phoneMode.setMode(a, PhoneMode.NORMAL))
        assertTrue(persistentHome(a.packageName).isEmpty())
        assertEquals(listOf(samsung), persistentHome(PhoneMode.SAMSUNG_LAUNCHER))

        assertEquals("ok", a.phoneMode.setMode(a, PhoneMode.SURVIVAL))
        assertTrue(persistentHome(PhoneMode.SAMSUNG_LAUNCHER).isEmpty())
        assertEquals(listOf(ComponentName(app, MainActivity::class.java)), persistentHome(a.packageName))

        // What the boot receiver does after a reboot: the saved mode is applied again.
        a.prefs.mode = PhoneMode.NORMAL
        BootReceiver().onReceive(app, Intent(Intent.ACTION_BOOT_COMPLETED))
        assertEquals(listOf(samsung), persistentHome(PhoneMode.SAMSUNG_LAUNCHER))
        val status = a.phoneMode.status()
        assertTrue(status.getBoolean("owner"))
        assertEquals(PhoneMode.NORMAL, status.getString("mode"))
    }

    @Test
    fun normalModeIsRefusedWhenNoOtherHomeAppExists() {
        val a = controller().get()
        val dpm = app.getSystemService(DevicePolicyManager::class.java)
        shadowOf(dpm).setDeviceOwner(ComponentName(app, KioskAdminReceiver::class.java))
        assertEquals("no-other-home", a.phoneMode.setMode(a, PhoneMode.NORMAL))
        assertEquals(PhoneMode.SURVIVAL, a.phoneMode.mode)
    }

    private fun persistentHome(pkg: String): List<ComponentName> {
        val filters = mutableListOf<IntentFilter>()
        val comps = mutableListOf<ComponentName>()
        shadowOf(app.packageManager).getPersistentPreferredActivities(filters, comps, pkg)
        return comps.filterIndexed { i, _ -> filters[i].hasCategory(Intent.CATEGORY_HOME) }
    }

    @Test
    fun mapFilesAreServedWithByteRanges() {
        val a = controller().get()
        MapFiles.baseForTests = java.nio.file.Files.createTempDirectory("media").toFile()
        val dir = MapFiles.dir(a)!!
        val f = File(dir, "gb.pmtiles")
        f.writeBytes(ByteArray(1000) { (it % 251).toByte() })
        try {
            // What Android WebView does with an intercepted response (components/embedder_support/android/util/
            // input_stream_reader.cc): total = available(), skip the Range start itself, then read to end of stream.
            fun webViewRead(r: android.webkit.WebResourceResponse, rangeStart: Long?): ByteArray {
                val s = r.data
                val total = s.available()
                if (rangeStart != null) {
                    assertTrue("WebView would answer 416: available()=$total", rangeStart < total)
                    var left = rangeStart
                    while (left > 0) { val k = s.skip(left); assertTrue(k > 0); left -= k }
                }
                return s.readBytes()
            }
            fun slice(from: Int, to: Int) = ByteArray(to - from + 1) { ((from + it) % 251).toByte() }

            val r = MapFiles.serve(a, "/maps/gb.pmtiles", "bytes=10-19")
            assertEquals(206, r.statusCode)
            assertEquals("bytes 10-19/1000", r.responseHeaders["Content-Range"])
            assertTrue(slice(10, 19).contentEquals(webViewRead(r, 10)))
            // A WebView that didn't skip would still get the right bytes.
            assertTrue(slice(500, 899).contentEquals(MapFiles.serve(a, "/maps/gb.pmtiles", "bytes=500-899").data.readBytes()))
            // The map's own reads: ?r=start-end, no Range header, so WebView passes the stream through.
            val q = MapFiles.serve(a, "/maps/gb.pmtiles", null, "600-999")
            assertEquals(206, q.statusCode)
            assertEquals(400, q.data.available())
            assertTrue(slice(600, 999).contentEquals(webViewRead(q, null)))
            assertTrue(slice(900, 999).contentEquals(webViewRead(MapFiles.serve(a, "/maps/gb.pmtiles", "bytes=-100"), 900)))
            assertEquals(404, MapFiles.serve(a, "/maps/../secret", null).statusCode)
            assertEquals(200, MapFiles.serve(a, "/maps/gb.pmtiles", null).statusCode)
            assertEquals(416, MapFiles.serve(a, "/maps/gb.pmtiles", "bytes=5000-").statusCode)
            val st = JSONObject(MapFiles.status(a).toString())
            assertEquals(1000, st.getJSONObject("files").getJSONObject("gb.pmtiles").getInt("size"))
        } finally {
            MapFiles.baseForTests?.deleteRecursively()
            MapFiles.baseForTests = null
        }
    }

    @Test
    fun oldLocalStorageIsHandedToTheNewOrigin() {
        val a = controller().get()
        val webView = a.findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as WebView
        WebBridge(a).migrateStorage("{\"saved\":\"[\\\"a:hypothermia\\\"]\"}")
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(MainActivity.APP_URL, shadowOf(webView).lastLoadedUrl)
        val handed = WebBridge(a).takeMigratedStorage()
        assertTrue(handed!!.contains("hypothermia"))
        assertEquals(null, WebBridge(a).takeMigratedStorage()) // only once
    }
}
