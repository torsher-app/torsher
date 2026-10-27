package app.torsher.androidtv

import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject

enum class CheckResult { Ok, Timeout, Unreachable, NotTorsher }

const val CHECK_TIMEOUT_MS = 5_000

/** Тело ответа health: сервер Torsher отвечает `{ "status": "ok" }` */
fun isHealthBody(body: String): Boolean = try {
    JSONObject(body).optString("status") == "ok"
} catch (_: JSONException) {
    false
}

/** Ответ на запрос health или исключение, если запрос не дошёл */
fun interface HealthRequest {
    fun get(url: String, timeoutMs: Int): Pair<Int, String>
}

val httpHealthRequest = HealthRequest { url, timeoutMs ->
    val connection = URL(url).openConnection() as HttpURLConnection
    try {
        // Срок общий на соединение и ответ: чтению остаётся то, что не ушло на connect
        val startedAt = System.nanoTime()
        connection.connectTimeout = timeoutMs
        connection.connect()
        val spentMs = ((System.nanoTime() - startedAt) / 1_000_000).toInt()
        connection.readTimeout = (timeoutMs - spentMs).coerceAtLeast(1)
        val status = connection.responseCode
        val stream = if (status in 200..299) connection.inputStream else connection.errorStream
        status to (stream?.bufferedReader()?.use { it.readText() } ?: "")
    } finally {
        connection.disconnect()
    }
}

/**
 * Сервер считается Torsher, если health ответил 200 и `{ status: 'ok' }`.
 * Ответ другого сервиса на том же адресе — `NotTorsher`, а не «недоступен»:
 * пользователю нужна другая подсказка.
 */
suspend fun checkServer(
    base: String,
    request: HealthRequest = httpHealthRequest,
    timeoutMs: Int = CHECK_TIMEOUT_MS,
): CheckResult = withContext(Dispatchers.IO) {
    try {
        val (status, body) = request.get(healthUrl(base), timeoutMs)
        if (status == 200 && isHealthBody(body)) CheckResult.Ok else CheckResult.NotTorsher
    } catch (_: SocketTimeoutException) {
        CheckResult.Timeout
    } catch (_: IOException) {
        CheckResult.Unreachable
    }
}
