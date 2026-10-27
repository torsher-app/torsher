package app.torsher.androidtv

/** Минимальный Chromium витрины (webOS 5): ниже сборка не рассчитана */
const val MIN_WEBVIEW_MAJOR = 68

/**
 * Устарел ли WebView по `versionName` пакета (`120.0.6099.230`). Неизвестную
 * версию устаревшей не считаем: проверка — подсказка, а не запрет.
 */
fun isWebViewOutdated(versionName: String?): Boolean {
    val major = versionName?.substringBefore('.')?.toIntOrNull() ?: return false
    return major < MIN_WEBVIEW_MAJOR
}
