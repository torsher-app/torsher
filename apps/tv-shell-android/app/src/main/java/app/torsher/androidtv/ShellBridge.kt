package app.torsher.androidtv

import android.view.KeyEvent
import org.json.JSONException
import org.json.JSONObject

/** Имя объекта, через который витрина шлёт сообщения: `window.torsherBridge.postMessage` */
const val BRIDGE_OBJECT = "torsherBridge"

/** Что витрина просит у оболочки. Сообщения — JSON с полем `type` */
sealed interface ShowcaseMessage {
    /** Витрина подключила мост: дальше Back уходит ей событием */
    data object Ready : ShowcaseMessage

    /** Витрине некуда возвращаться по Back: выходим из приложения */
    data object BackUnhandled : ShowcaseMessage

    /** «Сменить сервер»: экран адреса */
    data object ChangeServer : ShowcaseMessage

    /** Видео или заставка витрины: экран не гаснет, пока `on` */
    data class KeepScreenOn(val on: Boolean) : ShowcaseMessage

    /** Команда нативному плееру: витрина управляет им вместо `<video>` */
    data class Player(val command: PlayerCommand) : ShowcaseMessage
}

/** Команды плеера — то, что витрина делала бы с `<video>`. Время — в секундах */
sealed interface PlayerCommand {
    data class Load(val url: String) : PlayerCommand
    data object Play : PlayerCommand
    data object Pause : PlayerCommand
    data class Seek(val time: Double) : PlayerCommand
    data class Rate(val rate: Float) : PlayerCommand

    /** Аудиодорожка по порядку дорожек файла, как `audioTracks[i].enabled` */
    data class Audio(val index: Int) : PlayerCommand

    /** Видео ушло с экрана: плеер освобождает декодер и поверхность */
    data object Stop : PlayerCommand
}

private fun parsePlayerCommand(type: String, message: JSONObject): PlayerCommand? = when (type) {
    "player.load" -> message.optString("url").takeIf { it.isNotEmpty() }?.let(PlayerCommand::Load)
    "player.play" -> PlayerCommand.Play
    "player.pause" -> PlayerCommand.Pause
    "player.seek" -> message.optDouble("time").takeIf { it.isFinite() && it >= 0 }?.let(PlayerCommand::Seek)
    "player.rate" -> message.optDouble("rate").takeIf { it.isFinite() && it > 0 }?.let { PlayerCommand.Rate(it.toFloat()) }
    "player.audio" -> message.optInt("index", -1).takeIf { it >= 0 }?.let(PlayerCommand::Audio)
    "player.stop" -> PlayerCommand.Stop
    else -> null
}

fun parseShowcaseMessage(json: String): ShowcaseMessage? {
    val message = try {
        JSONObject(json)
    } catch (_: JSONException) {
        return null
    }

    val type = message.optString("type")

    return when (type) {
        "ready" -> ShowcaseMessage.Ready
        "back.unhandled" -> ShowcaseMessage.BackUnhandled
        "server.change" -> ShowcaseMessage.ChangeServer
        "screen.keepOn" -> ShowcaseMessage.KeepScreenOn(message.optBoolean("on"))
        else -> parsePlayerCommand(type, message)?.let(ShowcaseMessage::Player)
    }
}

/**
 * Клавиши, которые WebView в страницу не передаёт: Back забирает Activity,
 * медиакнопки — система. Оболочка присылает их событием `key` с кодом,
 * который витрина читает как клавишу пульта (`apps/tv/src/focus/keys.ts`).
 */
private val SHOWCASE_KEYS = mapOf(
    KeyEvent.KEYCODE_BACK to 166,
    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE to 179,
    KeyEvent.KEYCODE_MEDIA_PLAY to 415,
    KeyEvent.KEYCODE_MEDIA_PAUSE to 19,
    KeyEvent.KEYCODE_MEDIA_STOP to 178,
    KeyEvent.KEYCODE_MEDIA_FAST_FORWARD to 228,
    KeyEvent.KEYCODE_MEDIA_REWIND to 227,
)

/** DOM keyCode для клавиши Android, которую витрина получает через мост */
fun showcaseKeyCode(androidKeyCode: Int): Int? = SHOWCASE_KEYS[androidKeyCode]

/** События оболочки для витрины */
object ShellEvent {
    fun key(keyCode: Int): String = JSONObject().put("type", "key").put("keyCode", keyCode).toString()
}

/**
 * Выполняется в странице сервера до её скриптов: по `window.TorsherShell`
 * витрина узнаёт, что открыта в оболочке Android, и включает мост.
 */
fun documentStartScript(version: String, deviceProfile: JSONObject): String {
    val shell = JSONObject()
        .put("platform", "android")
        .put("version", version)
        .put("bridge", BRIDGE_OBJECT)
        // Видео играет Media3: витрина отдаёт ему поток вместо своего <video>
        .put("nativePlayer", true)
        .put("deviceProfile", deviceProfile)

    return "window.TorsherShell = Object.freeze($shell);"
}
