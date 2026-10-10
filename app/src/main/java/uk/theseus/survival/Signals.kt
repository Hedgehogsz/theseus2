package uk.theseus.survival

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.min
import kotlin.math.sin

/**
 * Timed torch and sound patterns for the signalling, Morse and CPR tools: SOS, the six-a-minute mountain distress
 * signal, Morse text and the CPR metronome.
 *
 * A pattern is a list of durations in ms, alternating on/off, starting with "on". Patterns run only while the guide is
 * on screen ([stopAll] is called from Activity.onPause) and always stop after [maxMs]. Sound uses the alarm stream so
 * it is loud even if media volume is down; "loud" patterns turn the alarm volume to full and restore it afterwards.
 */
class Signals(private val context: Context, private val emit: (event: String, data: JSONObject) -> Unit) {
    private val handler = Handler(Looper.getMainLooper())
    private val audio = context.getSystemService(AudioManager::class.java)
    private val running = mutableMapOf<String, Run>()
    private var savedAlarmVolume = -1

    private inner class Run(
        val channel: String,
        val pattern: LongArray,
        val repeat: Boolean,
        val freq: Int,
        val endAt: Long,
    ) : Runnable {
        var i = 0
        var cycles = 0
        override fun run() {
            if (running[channel] !== this) return
            if (SystemClock.uptimeMillis() >= endAt) {
                stop(channel, "timeout"); return
            }
            if (i >= pattern.size) {
                if (!repeat) { stop(channel, "done"); return }
                i = 0; cycles++
            }
            val on = i % 2 == 0
            val ms = pattern[i]
            if (on) {
                when (channel) {
                    "torch" -> Torch.set(context, true)
                    "sound" -> beep(freq, ms)
                }
                emit("signal-beat", JSONObject().put("channel", channel).put("index", i / 2).put("cycle", cycles))
            } else if (channel == "torch") {
                Torch.set(context, false)
            }
            i++
            handler.postAtTime(this, SystemClock.uptimeMillis() + ms)
        }
    }

    fun isRunning(channel: String) = running.containsKey(channel)

    fun start(channel: String, pattern: LongArray, repeat: Boolean, freq: Int, loud: Boolean, maxMs: Long): Boolean {
        if (channel !in setOf("torch", "sound") || pattern.isEmpty() || pattern.any { it < 20 }) return false
        stop(channel, "replaced")
        if (channel == "sound" && loud && savedAlarmVolume < 0) {
            savedAlarmVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM)
            runCatching { audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0) }
        }
        val r = Run(channel, pattern, repeat, freq.coerceIn(200, 4000), SystemClock.uptimeMillis() + min(maxMs, MAX_MS))
        running[channel] = r
        handler.post(r)
        return true
    }

    fun stop(channel: String, reason: String = "stopped") {
        val r = running.remove(channel) ?: return
        handler.removeCallbacks(r)
        if (channel == "torch") Torch.off(context)
        if (channel == "sound") {
            track?.let { runCatching { it.stop() } }
            if (savedAlarmVolume >= 0) {
                runCatching { audio.setStreamVolume(AudioManager.STREAM_ALARM, savedAlarmVolume, 0) }
                savedAlarmVolume = -1
            }
        }
        emit("signal-stopped", JSONObject().put("channel", channel).put("reason", reason))
    }

    fun stopAll(reason: String = "paused") {
        running.keys.toList().forEach { stop(it, reason) }
    }

    fun release() {
        stopAll("closed")
        track?.release(); track = null
    }

    // --- tone ---------------------------------------------------------------------------------------------------

    private var track: AudioTrack? = null
    private var trackKey = ""

    /** Plays a sine tone with soft edges (no clicks). One static buffer is reused while the tone stays the same. */
    private fun beep(freq: Int, ms: Long) {
        runCatching { playTone(freq, ms) } // audio failures must never stop a beacon's torch or crash the app
    }

    private fun playTone(freq: Int, ms: Long) {
        val rate = 22050
        val key = "$freq/$ms"
        if (key != trackKey || track == null) {
            track?.release()
            val n = (rate * ms / 1000).toInt().coerceAtLeast(64)
            val buf = ShortArray(n)
            val fade = (rate * 0.006).toInt()
            for (k in 0 until n) {
                val env = minOf(1.0, k / fade.toDouble(), (n - 1 - k) / fade.toDouble())
                buf[k] = (sin(2 * PI * freq * k / rate) * env * 0.95 * Short.MAX_VALUE).toInt().toShort()
            }
            track = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build(),
                )
                .setAudioFormat(
                    AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(rate)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build(),
                )
                .setTransferMode(AudioTrack.MODE_STATIC)
                .setBufferSizeInBytes(n * 2)
                .build()
            track!!.write(buf, 0, n)
            trackKey = key
        }
        val t = track ?: return
        runCatching {
            if (t.playState == AudioTrack.PLAYSTATE_PLAYING) t.stop()
            t.reloadStaticData()
            t.play()
        }
    }

    companion object {
        /** Hard upper limit for any pattern, whatever the screen asked for. */
        const val MAX_MS = 2 * 60 * 60_000L

        fun parsePattern(json: String): LongArray =
            runCatching { org.json.JSONArray(json).let { a -> LongArray(a.length()) { a.getLong(it) } } }.getOrDefault(LongArray(0))
    }
}
