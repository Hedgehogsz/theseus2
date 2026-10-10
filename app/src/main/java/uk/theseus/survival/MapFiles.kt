package uk.theseus.survival

import android.content.Context
import android.webkit.WebResourceResponse
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer

/**
 * Serves the offline map files to the WebView at https://appassets.androidplatform.net/maps/<name>, with HTTP range
 * requests (PMTiles reads small byte ranges of a multi-gigabyte file).
 *
 * The files live in the app's external media directory, /sdcard/Android/media/uk.theseus.survival/maps/, which needs
 * no storage permission and is where `adb push` puts them. They are never bundled in the APK.
 */
object MapFiles {
    val NAMES = listOf("gb.pmtiles", "contours.pmtiles", "places.tsv")
    private val SAFE = Regex("^[a-z0-9][a-z0-9._-]{0,63}$")

    /** Unit tests only: the test runner has no external storage. */
    internal var baseForTests: File? = null

    fun dir(context: Context): File? {
        @Suppress("DEPRECATION")
        val base = baseForTests ?: context.externalMediaDirs.firstOrNull { it != null } ?: return null
        return File(base, "maps").also { it.mkdirs() }
    }

    fun status(context: Context): JSONObject {
        val d = dir(context)
        val files = JSONObject()
        for (n in NAMES) {
            val f = d?.let { File(it, n) }
            files.put(n, if (f != null && f.isFile) JSONObject().put("size", f.length()).put("modified", f.lastModified()) else JSONObject.NULL)
        }
        return JSONObject().put("dir", d?.absolutePath ?: JSONObject.NULL)
            .put("sdcardDir", "/sdcard/Android/media/${context.packageName}/maps")
            .put("files", files)
    }

    /**
     * Serves /maps/<name>. A byte range can come two ways:
     *
     * - `?r=start-end` in the URL (what the map uses). The WebView sees no Range header, so it passes our stream
     *   through untouched.
     * - A `Range: bytes=start-end` header. Android WebView applies that header to the stream we return a second
     *   time: it reads [InputStream.available] as the total size, skips `start` bytes itself, then reads to the end
     *   of the stream. v1.2.0 returned a stream already positioned at `start`, so WebView skipped past the data and
     *   every read beyond the first 16 KB failed (the map drew nothing). [Window] now behaves like the whole file up
     *   to `end`, so WebView's skip lands on `start`; if a WebView doesn't skip, the first read jumps there instead.
     *
     * Content-Length is left to WebView, which sets it from [InputStream.available]; adding our own would duplicate
     * the header.
     */
    fun serve(context: Context, path: String, rangeHeader: String?, rangeParam: String? = null): WebResourceResponse {
        val name = path.removePrefix("/maps/")
        val file = dir(context)?.let { File(it, name) }
        if (!SAFE.matches(name) || file == null || !file.isFile) return error(404, "Not Found")
        val len = file.length()
        val mime = when {
            name.endsWith(".pmtiles") -> "application/octet-stream"
            name.endsWith(".tsv") -> "text/tab-separated-values"
            else -> "application/octet-stream"
        }
        val headers = mutableMapOf(
            "Accept-Ranges" to "bytes",
            "Cache-Control" to "no-store",
            "Access-Control-Allow-Origin" to "*",
            "Access-Control-Expose-Headers" to "Content-Range, Content-Length, ETag",
            "ETag" to "\"${len}-${file.lastModified()}\"",
        )
        val spec = rangeParam?.let { "bytes=$it" } ?: rangeHeader
        val r = spec?.let { Regex("^bytes=(\\d*)-(\\d*)$").find(it.trim()) }
        if (r == null) return WebResourceResponse(mime, null, 200, "OK", headers, FileInputStream(file))
        val (a, b) = r.destructured
        val start: Long
        val end: Long
        if (a.isEmpty()) { // suffix range: the last N bytes
            val n = b.toLongOrNull() ?: return error(416, "Range Not Satisfiable")
            start = (len - n).coerceAtLeast(0); end = len - 1
        } else {
            start = a.toLong(); end = (b.toLongOrNull() ?: (len - 1)).coerceAtMost(len - 1)
        }
        if (start > end || start >= len) {
            headers["Content-Range"] = "bytes */$len"
            return WebResourceResponse(mime, null, 416, "Range Not Satisfiable", headers, ByteArrayInputStreamEmpty)
        }
        headers["Content-Range"] = "bytes $start-$end/$len"
        // With a Range header WebView skips to `start` itself, so the stream starts at byte 0; with ?r= it doesn't.
        val origin = if (rangeParam != null) start else 0L
        return WebResourceResponse(mime, null, 206, "Partial Content", headers, Window(file, start, end, origin))
    }

    private fun error(code: Int, reason: String) =
        WebResourceResponse("text/plain", "utf-8", code, reason, mapOf("Access-Control-Allow-Origin" to "*"), ByteArrayInputStreamEmpty)

    private val ByteArrayInputStreamEmpty: InputStream get() = java.io.ByteArrayInputStream(ByteArray(0))

    /**
     * Bytes [start]..[end] of [file], seen as a stream that begins at file offset [origin]: [available] counts from
     * the current position to [end], [skip] moves the position without reading, and the first read never starts
     * before [start]. Reads use positional FileChannel reads, so nothing is copied but the requested bytes.
     */
    internal class Window(file: File, private val start: Long, private val end: Long, origin: Long) : InputStream() {
        private val channel = RandomAccessFile(file, "r").channel
        private var pos = origin

        override fun available(): Int = (end + 1 - pos).coerceIn(0, Int.MAX_VALUE.toLong()).toInt()

        override fun skip(n: Long): Long {
            val k = n.coerceIn(0, (end + 1 - pos).coerceAtLeast(0))
            pos += k
            return k
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (pos < start) pos = start
            if (pos > end) return -1
            if (len == 0) return 0
            val n = channel.read(ByteBuffer.wrap(b, off, minOf(len.toLong(), end + 1 - pos).toInt()), pos)
            if (n > 0) pos += n
            return n
        }

        override fun read(): Int {
            val one = ByteArray(1)
            return if (read(one, 0, 1) == 1) one[0].toInt() and 0xff else -1
        }

        override fun close() = channel.close()
    }
}
