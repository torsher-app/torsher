package app.torsher.androidtv

import androidx.media3.common.PlaybackException
import org.json.JSONArray
import org.json.JSONObject

// readyState из HTMLMediaElement
const val HAVE_NOTHING = 0
const val HAVE_METADATA = 1
const val HAVE_CURRENT_DATA = 2
const val HAVE_ENOUGH_DATA = 4

// MediaError.code
private const val MEDIA_ERR_NETWORK = 2
private const val MEDIA_ERR_DECODE = 3
private const val MEDIA_ERR_SRC_NOT_SUPPORTED = 4

data class AudioTrackState(val language: String?, val label: String?, val enabled: Boolean)

data class PlayerErrorState(val code: Int, val message: String)

/**
 * Код MediaError по коду ошибки Media3: сеть и HTTP — сетевая ошибка,
 * декодер — ошибка декодирования, остальное — формат не поддерживается.
 */
fun mediaErrorCode(errorCode: Int): Int = when (errorCode) {
    in PlaybackException.ERROR_CODE_IO_UNSPECIFIED..2999 -> MEDIA_ERR_NETWORK
    in PlaybackException.ERROR_CODE_DECODER_INIT_FAILED..4999 -> MEDIA_ERR_DECODE
    else -> MEDIA_ERR_SRC_NOT_SUPPORTED
}

/**
 * Что витрина читает у `<video>`, и события с прошлого снимка. Снимок уходит
 * целиком: витрина сначала обновляет свойства, потом шлёт события по порядку.
 */
class PlayerState {
    var time = 0.0
    var duration: Double? = null
    var buffered = 0.0
    var paused = true
    var ended = false
    var rate = 1f
    var readyState = HAVE_NOTHING
    var audio: List<AudioTrackState> = emptyList()
    var error: PlayerErrorState? = null
    val events = mutableListOf<String>()

    fun reset() {
        time = 0.0
        duration = null
        buffered = 0.0
        paused = true
        ended = false
        readyState = HAVE_NOTHING
        audio = emptyList()
        error = null
    }

    fun snapshot(): String = JSONObject()
        .put("type", "player.state")
        .put("time", time)
        .put("duration", duration ?: JSONObject.NULL)
        .put("buffered", buffered)
        .put("paused", paused)
        .put("ended", ended)
        .put("rate", rate.toDouble())
        .put("readyState", readyState)
        .put(
            "audio",
            JSONArray(
                audio.map {
                    JSONObject()
                        .put("language", it.language ?: JSONObject.NULL)
                        .put("label", it.label ?: JSONObject.NULL)
                        .put("enabled", it.enabled)
                },
            ),
        )
        .put("error", error?.let { JSONObject().put("code", it.code).put("message", it.message) } ?: JSONObject.NULL)
        .put("events", JSONArray(events))
        .toString()
}
