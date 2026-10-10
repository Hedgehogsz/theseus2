package uk.theseus.survival

import android.content.Context
import android.webkit.WebResourceResponse
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.InputStream

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

    fun serve(context: Context, path: String, range: String?): WebResourceResponse {
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
        val r = range?.let { Regex("^bytes=(\\d*)-(\\d*)$").find(it.trim()) }
        if (r == null) {
            headers["Content-Length"] = len.toString()
            return WebResourceResponse(mime, null, 200, "OK", headers, FileInputStream(file))
        }
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
        val count = end - start + 1
        headers["Content-Range"] = "bytes $start-$end/$len"
        headers["Content-Length"] = count.toString()
        val input = FileInputStream(file).apply { channel.position(start) }
        return WebResourceResponse(mime, null, 206, "Partial Content", headers, Limited(input, count))
    }

    private fun error(code: Int, reason: String) =
        WebResourceResponse("text/plain", "utf-8", code, reason, mapOf("Access-Control-Allow-Origin" to "*"), ByteArrayInputStreamEmpty)

    private val ByteArrayInputStreamEmpty: InputStream get() = java.io.ByteArrayInputStream(ByteArray(0))

    /** Reads at most [remaining] bytes from [inner]. */
    internal class Limited(private val inner: InputStream, private var remaining: Long) : InputStream() {
        override fun read(): Int {
            if (remaining <= 0) return -1
            val v = inner.read()
            if (v >= 0) remaining--
            return v
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (remaining <= 0) return -1
            val n = inner.read(b, off, minOf(len.toLong(), remaining).toInt())
            if (n > 0) remaining -= n
            return n
        }

        override fun available(): Int = minOf(inner.available().toLong(), remaining).toInt()
        override fun close() = inner.close()
    }
}
