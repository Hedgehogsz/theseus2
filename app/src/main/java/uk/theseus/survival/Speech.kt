package uk.theseus.survival

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import org.json.JSONObject
import java.util.Locale

/**
 * "Read this page" using whatever text-to-speech engine is installed (Google TTS may not work fully without Google
 * Play services, Samsung's engine may be present). Only offered if an English voice works offline. The engine is
 * bound only when needed and released when the guide is paused, so it costs nothing in the background.
 */
class Speech(private val context: Context, private val prefs: Prefs, private val emit: (String, JSONObject) -> Unit) {
    private var tts: TextToSpeech? = null
    private var ready = false
    private var pending: (() -> Unit)? = null
    private var enginesTried = 0

    private val engineOrder: List<String?> = listOf(null, "com.google.android.tts", "com.samsung.SMT")

    /** Binds an engine (if needed) and reports {available} via the "tts" event. */
    fun check() {
        if (ready) { report(); return }
        init()
    }

    private fun init() {
        val engine = engineOrder.getOrNull(enginesTried) ?: run {
            prefs.ttsAvailable = 0
            emit("tts", JSONObject().put("available", false))
            return
        }
        enginesTried++
        tts = TextToSpeech(context, { status ->
            if (status == TextToSpeech.SUCCESS && pickVoice()) {
                ready = true
                report()
                pending?.invoke(); pending = null
            } else {
                tts?.shutdown(); tts = null
                init() // try the next engine
            }
        }, engine)
    }

    private fun pickVoice(): Boolean {
        val t = tts ?: return false
        val voices: Set<Voice> = runCatching { t.voices }.getOrNull() ?: emptySet()
        val offline = voices.filter {
            it.locale.language == "en" && !it.isNetworkConnectionRequired &&
                !it.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)
        }
        val voice = offline.firstOrNull { it.locale.country == "GB" } ?: offline.firstOrNull()
        if (voice != null) return t.setVoice(voice) == TextToSpeech.SUCCESS
        // Engines that don't list voices: fall back to the language check.
        return t.isLanguageAvailable(Locale.UK) >= TextToSpeech.LANG_AVAILABLE && t.setLanguage(Locale.UK) >= 0
    }

    private fun report() {
        prefs.ttsAvailable = if (ready) 1 else 0
        emit("tts", JSONObject().put("available", ready))
    }

    fun speak(text: String) {
        val go = {
            val t = tts!!
            t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(id: String) = emit("tts", JSONObject().put("speaking", true))
                override fun onDone(id: String) {
                    if (id == "last") emit("tts", JSONObject().put("speaking", false))
                }

                @Deprecated("Deprecated in Java")
                override fun onError(id: String) = emit("tts", JSONObject().put("speaking", false).put("error", true))
            })
            t.stop()
            val max = TextToSpeech.getMaxSpeechInputLength() - 100
            val chunks = chunk(text, max)
            chunks.forEachIndexed { i, c ->
                t.speak(c, TextToSpeech.QUEUE_ADD, null, if (i == chunks.lastIndex) "last" else "u$i")
            }
        }
        if (ready) go() else { pending = go; enginesTried = 0; init() }
    }

    fun stop() {
        pending = null
        tts?.stop()
    }

    /** Activity.onPause: stop talking and release the engine. */
    fun release() {
        stop()
        tts?.shutdown()
        tts = null
        ready = false
        enginesTried = 0
    }

    private fun chunk(text: String, max: Int): List<String> {
        val out = mutableListOf<String>()
        val sb = StringBuilder()
        for (para in text.split(Regex("\n+"))) {
            if (sb.length + para.length + 1 > max && sb.isNotEmpty()) { out += sb.toString(); sb.clear() }
            if (para.length > max) para.chunked(max).forEach { out += it } else sb.append(para).append('\n')
        }
        if (sb.isNotBlank()) out += sb.toString()
        return out
    }
}
