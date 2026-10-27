package app.torsher.androidtv

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.view.KeyEvent
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * Витрина сервера в WebView: переход верхнего уровня на origin сервера,
 * как у обёртки webOS. Мост виден только страницам этого origin — iframe
 * трейлеров и чужие страницы его не получают.
 */
@SuppressLint("SetJavaScriptEnabled")
class Showcase(
    context: Context,
    private val base: String,
    version: String,
    deviceProfile: JSONObject,
    private val events: Events,
) {
    interface Events {
        fun onMessage(message: ShowcaseMessage)

        /** Главная страница не загрузилась: сервер пропал или сменил адрес */
        fun onLoadFailed()

        /** Началась новая страница: прежняя больше не управляет плеером */
        fun onPageStarted()

        /** Процесс рендера WebView завершился: этот WebView больше не жилец */
        fun onRenderProcessGone()
    }

    val view = WebView(context)

    private val origin = originOf(base)
    private var reply: JavaScriptReplyProxy? = null

    init {
        // DevTools через chrome://inspect — только в отладочной сборке
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // Плеер стартует сам после выбора файла, без отдельного жеста
            mediaPlaybackRequiresUserGesture = false
        }
        view.setBackgroundColor(context.getColor(R.color.background))
        view.isFocusable = true
        view.isFocusableInTouchMode = true
        view.webViewClient = Client()
        // Медиакнопки WebView в страницу не передаёт: они уходят витрине через
        // мост. Back так не ловим — его разбирает OnBackPressedDispatcher
        view.setOnKeyListener { _, keyCode, event ->
            val showcaseKey = showcaseKeyCode(keyCode)
            if (showcaseKey == null || keyCode == KeyEvent.KEYCODE_BACK || !connected) {
                false
            } else {
                if (event.action == KeyEvent.ACTION_DOWN) sendKey(showcaseKey)
                true
            }
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(view, documentStartScript(version, deviceProfile), setOf(origin))
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(view, BRIDGE_OBJECT, setOf(origin)) { _, message, _, isMainFrame, replyProxy ->
                val parsed = message.data?.let(::parseShowcaseMessage)
                if (isMainFrame && parsed != null) {
                    if (parsed == ShowcaseMessage.Ready) reply = replyProxy
                    events.onMessage(parsed)
                }
            }
        }
    }

    fun load() {
        view.post { view.requestFocus() }
        view.loadUrl(showcaseUrl(base))
    }

    /** Подключила ли текущая страница мост: клавиши уходят ей событиями */
    val connected get() = reply != null

    /** Клавиша для витрины; `false` — мост не подключён */
    fun sendKey(keyCode: Int): Boolean = send(ShellEvent.key(keyCode))

    /** Сообщение витрине; `false` — мост не подключён */
    // reply появляется только из слушателя, а его без WEB_MESSAGE_LISTENER нет
    @SuppressLint("RequiresFeature")
    fun send(message: String): Boolean {
        val bridge = reply ?: return false
        bridge.postMessage(message)
        return true
    }

    /** Под нативным видео WebView прозрачный: кадр виден сквозь страницу */
    fun setTransparent(transparent: Boolean) {
        view.setBackgroundColor(if (transparent) Color.TRANSPARENT else view.context.getColor(R.color.background))
    }

    /**
     * Back пульта. С мостом его разбирает витрина, как 461 на webOS; без
     * моста (панель, старый сервер) — история WebView. `false` — назад некуда.
     */
    fun back(): Boolean {
        if (sendKey(showcaseKeyCode(KeyEvent.KEYCODE_BACK)!!)) return true
        if (view.canGoBack()) {
            view.goBack()
            return true
        }
        return false
    }

    fun pause() = view.onPause()

    fun resume() = view.onResume()

    fun destroy() = view.destroy()

    private fun isServerPage(url: Uri) = runCatching { originOf(url.toString()) == origin }.getOrDefault(false)

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            // Браузера на ТВ нет: чужие страницы не открываем вовсе
            return !isServerPage(request.url)
        }

        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
            // Новая страница — новый документ: мост подключится заново, когда она пришлёт ready
            reply = null
            events.onPageStarted()
        }

        override fun onPageFinished(view: WebView, url: String) {
            // Клавиши пульта получает только WebView в фокусе: до прикрепления к
            // окну requestFocus не срабатывает, поэтому просим его после загрузки
            if (!view.hasFocus()) view.requestFocus()
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            events.onRenderProcessGone()
            return true
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) events.onLoadFailed()
        }
    }
}
