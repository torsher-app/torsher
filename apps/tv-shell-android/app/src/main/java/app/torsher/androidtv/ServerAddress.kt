package app.torsher.androidtv

import java.net.URI
import java.net.URISyntaxException

private val SCHEME = Regex("^[a-z][\\w+.-]*://", RegexOption.IGNORE_CASE)
private val DEFAULT_PORTS = mapOf("http" to 80, "https" to 443)

/**
 * Адрес из поля ввода → базовый URL сервера без хвостового `/`, по тем же
 * правилам, что у обёртки webOS. Без схемы — `http://`: в домашней сети
 * сервер обычно без TLS. Порт не подставляем, сервер может стоять за
 * обратным прокси на 80 или 443.
 */
fun normalizeAddress(input: String): String? {
    val value = input.trim()
    if (value.isEmpty()) return null

    val uri = try {
        URI(if (SCHEME.containsMatchIn(value)) value else "http://$value")
    } catch (_: URISyntaxException) {
        return null
    }

    val scheme = uri.scheme?.lowercase()
    val host = uri.host?.lowercase()
    if (scheme == null || scheme !in DEFAULT_PORTS || host.isNullOrEmpty()) return null
    if (uri.port > 65_535) return null

    val port = if (uri.port == -1 || uri.port == DEFAULT_PORTS[scheme]) "" else ":${uri.port}"
    val path = (uri.rawPath ?: "").trimEnd('/')

    return "$scheme://$host$port$path"
}

/** `http://` в подписи лишний, `https://` оставляем: он о чём-то говорит */
fun displayAddress(base: String) = base.removePrefix("http://")

fun healthUrl(base: String) = "$base/api/health"

/** Витрина отдаётся с корня сервера; `platform=tv` включает режим ТВ */
fun showcaseUrl(base: String) = "$base/?platform=tv"

/** Origin базового адреса: по нему WebView пускает мост только на страницы сервера */
fun originOf(base: String): String {
    val uri = URI(base)
    val port = if (uri.port == -1) "" else ":${uri.port}"
    return "${uri.scheme}://${uri.host}$port"
}
