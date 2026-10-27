package app.torsher.androidtv

import android.graphics.Color
import android.os.Bundle
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.WindowManager
import android.webkit.CookieManager
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.ComposeView
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewCompat
import kotlinx.coroutines.launch

/**
 * Одна Activity: экраны оболочки на Compose, затем витрина сервера в WebView
 * поверх них. Поведение экрана адреса — как у обёртки webOS.
 */
class MainActivity : ComponentActivity() {
    private val store by lazy { ServerStore(this) }

    // Декодеры и выход звука за время работы не меняются: профиль собираем раз
    private val profile by lazy { deviceProfile(this) }
    private val screen = mutableStateOf<ShellScreen>(ShellScreen.Address(""))

    private lateinit var root: FrameLayout
    private lateinit var shell: ComposeView
    private lateinit var player: NativePlayer
    private var showcase: Showcase? = null

    // Ответ прежней проверки, которую отменили «Сменить адрес», игнорируется
    private var attempt = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        shell = ComposeView(this).apply {
            setContent {
                ShellApp(
                    screen = screen.value,
                    onConnect = ::submit,
                    onChangeAddress = { showAddress() },
                    onContinueOutdated = ::start,
                )
            }
        }
        // Видео рисуется под витриной: поверхность — нижний слой окна
        val surface = SurfaceView(this).apply { visibility = View.GONE }
        player = NativePlayer(
            this,
            surface,
            send = { showcase?.send(it) },
            onActiveChanged = { active ->
                surface.visibility = if (active) View.VISIBLE else View.GONE
                // Поля вокруг кадра — чёрные, как фон плеера витрины
                root.setBackgroundColor(if (active) Color.BLACK else Color.TRANSPARENT)
                showcase?.setTransparent(active)
            },
        )
        root = FrameLayout(this).apply {
            addView(surface, MATCH_PARENT, MATCH_PARENT)
            addView(shell, MATCH_PARENT, MATCH_PARENT)
        }
        setContentView(root)
        onBackPressedDispatcher.addCallback(this, back)

        val webView = WebViewCompat.getCurrentWebViewPackage(this)?.versionName
        if (isWebViewOutdated(webView)) screen.value = ShellScreen.Outdated(webView.orEmpty())
        else start()
    }

    override fun onPause() {
        super.onPause()
        player.pauseForBackground()
        showcase?.pause()
        // WebView пишет cookie на диск лениво: без этого сессия устройства
        // теряется, если систему выгрузит приложение из фона
        CookieManager.getInstance().flush()
    }

    override fun onResume() {
        super.onResume()
        showcase?.resume()
    }

    override fun onDestroy() {
        closeShowcase()
        super.onDestroy()
    }

    /** Сохранённый адрес проверяем и открываем сразу */
    private fun start() {
        val saved = store.load()
        if (saved != null) connect(saved) else showAddress()
    }

    private fun submit(input: String) {
        val base = normalizeAddress(input)
        if (base == null) {
            showAddress(input, getString(R.string.shell_errors_invalid))
            return
        }
        connect(base)
    }

    private fun showAddress(input: String? = null, error: String? = null) {
        attempt++
        closeShowcase()
        screen.value = ShellScreen.Address(input ?: store.load()?.let(::displayAddress).orEmpty(), error)
    }

    private fun connect(base: String) {
        val current = ++attempt
        screen.value = ShellScreen.Connecting(base)

        lifecycleScope.launch {
            val result = checkServer(base)
            if (current != attempt) return@launch

            if (result == CheckResult.Ok) {
                store.save(base)
                openShowcase(base)
            } else {
                showAddress(displayAddress(base), errorText(result, base))
            }
        }
    }

    private fun errorText(result: CheckResult, base: String): String {
        val id = when (result) {
            CheckResult.Timeout -> R.string.shell_errors_timeout
            CheckResult.NotTorsher -> R.string.shell_errors_not_torsher
            else -> R.string.shell_errors_unreachable
        }
        return getString(id, displayAddress(base))
    }

    private fun openShowcase(base: String) {
        val opened = Showcase(this, base, BuildConfig.VERSION_NAME, profile, ShowcaseEvents(base))
        showcase = opened
        root.addView(opened.view, MATCH_PARENT, MATCH_PARENT)
        shell.visibility = View.GONE
        opened.load()
    }

    private fun closeShowcase() {
        val opened = showcase ?: return
        player.release()
        showcase = null
        keepScreenOn(false)
        root.removeView(opened.view)
        opened.destroy()
        shell.visibility = View.VISIBLE
    }

    private fun keepScreenOn(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    private inner class ShowcaseEvents(private val base: String) : Showcase.Events {
        override fun onMessage(message: ShowcaseMessage) {
            when (message) {
                ShowcaseMessage.Ready -> Unit
                ShowcaseMessage.BackUnhandled -> finish()
                ShowcaseMessage.ChangeServer -> showAddress()
                is ShowcaseMessage.KeepScreenOn -> keepScreenOn(message.on)
                is ShowcaseMessage.Player -> player.handle(message.command)
            }
        }

        override fun onPageStarted() = player.release()

        // Система убила рендер WebView (обычно нехватка памяти на слабой
        // приставке): витрина открывается заново с проверкой сервера
        override fun onRenderProcessGone() {
            closeShowcase()
            connect(base)
        }

        override fun onLoadFailed() {
            showAddress(displayAddress(base), errorText(CheckResult.Unreachable, base))
        }
    }

    private val back = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
            val opened = showcase
            when {
                opened != null -> if (!opened.back()) finish()
                // Back на экране подключения возвращает к адресу, как на webOS
                screen.value is ShellScreen.Connecting -> showAddress()
                else -> finish()
            }
        }
    }
}
