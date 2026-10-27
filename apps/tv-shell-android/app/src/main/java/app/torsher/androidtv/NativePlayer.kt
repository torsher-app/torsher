package app.torsher.androidtv

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import kotlin.math.roundToInt

/**
 * Media3 ExoPlayer под прозрачной витриной. Витрина управляет им, как своим
 * `<video>`, и получает обратно снимки состояния с событиями HTML-видео:
 * OSD, дорожки, субтитры и прогресс остаются в вебе.
 */
@OptIn(UnstableApi::class)
class NativePlayer(
    private val context: Context,
    /** Поверхность под WebView; оболочка показывает её, пока плеер активен */
    val surface: SurfaceView,
    private val send: (String) -> Unit,
    private val onActiveChanged: (Boolean) -> Unit,
) {
    private var player: ExoPlayer? = null
    private val state = PlayerState()
    private val ticker = Handler(Looper.getMainLooper())

    // Метаданные отдаются один раз на поток, как loadedmetadata у <video>
    private var metadataSent = false
    private var seeking = false

    private val tick = object : Runnable {
        override fun run() {
            if (player?.isPlaying == true) state.events += "timeupdate"
            publish()
            ticker.postDelayed(this, TICK_MS)
        }
    }

    fun handle(command: PlayerCommand) {
        when (command) {
            is PlayerCommand.Load -> load(command.url)
            PlayerCommand.Play -> play()
            PlayerCommand.Pause -> pause()
            is PlayerCommand.Seek -> seek(command.time)
            is PlayerCommand.Rate -> rate(command.rate)
            is PlayerCommand.Audio -> selectAudio(command.index)
            PlayerCommand.Stop -> release()
        }
    }

    private fun load(url: String) {
        val exo = player ?: create()
        metadataSent = false
        seeking = false
        state.reset()
        state.events += "emptied"
        exo.setMediaItem(MediaItem.fromUri(url))
        exo.playWhenReady = false
        exo.prepare()
        publish()
    }

    private fun create(): ExoPlayer {
        val exo = ExoPlayer.Builder(context).build()
        exo.setVideoSurfaceView(surface)
        exo.addListener(Listener())
        player = exo
        onActiveChanged(true)
        ticker.post(tick)
        return exo
    }

    private fun play() {
        val exo = player ?: return
        if (exo.playbackState == Player.STATE_ENDED) exo.seekTo(0)
        if (!exo.playWhenReady) {
            exo.playWhenReady = true
            state.paused = false
            state.events += "play"
            publish()
        }
    }

    private fun pause() {
        val exo = player ?: return
        if (exo.playWhenReady) {
            exo.playWhenReady = false
            state.paused = true
            state.events += "pause"
            publish()
        }
    }

    private fun seek(time: Double) {
        val exo = player ?: return
        seeking = true
        exo.seekTo((time * 1000).toLong())
        state.time = time
        state.events += "seeking"
        publish()
    }

    private fun rate(rate: Float) {
        val exo = player ?: return
        exo.playbackParameters = PlaybackParameters(rate)
        state.rate = rate
        state.events += "ratechange"
        publish()
    }

    /** Порядок аудиогрупп Media3 совпадает с порядком аудиодорожек файла */
    private fun selectAudio(index: Int) {
        val exo = player ?: return
        val group = exo.currentTracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }.getOrNull(index) ?: return
        exo.trackSelectionParameters = exo.trackSelectionParameters
            .buildUpon()
            .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, 0))
            .build()
    }

    /** Освободить декодер: витрина ушла с плеера или его закрыли */
    fun release() {
        val exo = player ?: return
        player = null
        ticker.removeCallbacks(tick)
        exo.release()
        state.reset()
        surface.layoutParams = FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)
        onActiveChanged(false)
    }

    /**
     * Кадр вписывается в экран с сохранением пропорций, как `object-fit:
     * contain` у `<video>`: поверхность встаёт по центру, поля остаются чёрными.
     */
    private fun fit(size: VideoSize) {
        val parent = surface.parent as? View ?: return
        if (size.width == 0 || size.height == 0 || parent.width == 0 || parent.height == 0) return

        val (width, height) = containSize(
            size.width * size.pixelWidthHeightRatio,
            size.height.toFloat(),
            parent.width,
            parent.height,
        )
        surface.layoutParams = FrameLayout.LayoutParams(width, height, Gravity.CENTER)
    }

    /** Свернули приложение: видео встаёт на паузу, витрина узнаёт об этом событием */
    fun pauseForBackground() = pause()

    private fun publish() {
        val exo = player
        if (exo != null) {
            state.time = if (seeking) state.time else exo.currentPosition / 1000.0
            state.duration = exo.duration.takeIf { it != C.TIME_UNSET }?.div(1000.0)
            state.buffered = exo.bufferedPosition / 1000.0
        }
        send(state.snapshot())
        state.events.clear()
    }

    private inner class Listener : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            val exo = player ?: return
            when (playbackState) {
                Player.STATE_READY -> {
                    if (!metadataSent) {
                        metadataSent = true
                        state.readyState = HAVE_METADATA
                        state.duration = exo.duration.takeIf { it != C.TIME_UNSET }?.div(1000.0)
                        state.events += listOf("durationchange", "loadedmetadata", "loadeddata")
                    }
                    state.readyState = HAVE_ENOUGH_DATA
                    state.events += "canplay"
                    if (seeking) {
                        seeking = false
                        state.events += "seeked"
                    }
                }
                Player.STATE_BUFFERING -> {
                    if (metadataSent) state.readyState = HAVE_CURRENT_DATA
                    if (exo.playWhenReady) state.events += "waiting"
                }
                Player.STATE_ENDED -> {
                    // <video> в конце сначала встаёт на паузу, потом шлёт ended
                    exo.playWhenReady = false
                    state.paused = true
                    state.ended = true
                    state.events += listOf("pause", "ended")
                }
                Player.STATE_IDLE -> Unit
            }
            publish()
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            // Экран держим, пока кадры идут: пауза на час отдаёт его системе
            surface.keepScreenOn = isPlaying
            if (isPlaying) {
                state.ended = false
                state.events += "playing"
                publish()
            }
        }

        override fun onTracksChanged(tracks: Tracks) {
            state.audio = tracks.groups
                .filter { it.type == C.TRACK_TYPE_AUDIO }
                .map { group ->
                    val format = group.getTrackFormat(0)
                    AudioTrackState(format.language, format.label, group.isSelected)
                }
            publish()
        }

        override fun onVideoSizeChanged(videoSize: VideoSize) {
            fit(videoSize)
        }

        override fun onPlayerError(error: PlaybackException) {
            state.error = PlayerErrorState(mediaErrorCode(error.errorCode), error.errorCodeName)
            state.events += "error"
            publish()
        }
    }

    private companion object {
        const val TICK_MS = 250L
    }
}

/** Размер кадра, вписанного в контейнер без обрезки */
fun containSize(videoWidth: Float, videoHeight: Float, boxWidth: Int, boxHeight: Int): Pair<Int, Int> {
    val video = videoWidth / videoHeight
    val box = boxWidth.toFloat() / boxHeight
    return if (video > box) boxWidth to (boxWidth / video).roundToInt()
    else (boxHeight * video).roundToInt() to boxHeight
}
