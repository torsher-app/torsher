@file:OptIn(UnstableApi::class)

package app.torsher.androidtv

import android.content.Context
import android.media.MediaCodecList
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioCapabilities
import org.json.JSONArray
import org.json.JSONObject

// Кодеки — именами ffprobe, как их называет сервер в описании файла. MPEG-2,
// MPEG-4 Part 2 (Xvid) и VC-1 не объявляем, как и на webOS: их копию в HLS
// сервер не собирает, такие файлы идут перекодированием
private val VIDEO_CODECS = mapOf(
    MimeTypes.VIDEO_H264 to "h264",
    MimeTypes.VIDEO_H265 to "hevc",
    MimeTypes.VIDEO_VP9 to "vp9",
    MimeTypes.VIDEO_AV1 to "av1",
)

private val AUDIO_CODECS = mapOf(
    MimeTypes.AUDIO_AAC to "aac",
    MimeTypes.AUDIO_MPEG to "mp3",
    MimeTypes.AUDIO_OPUS to "opus",
    MimeTypes.AUDIO_FLAC to "flac",
    MimeTypes.AUDIO_VORBIS to "vorbis",
    MimeTypes.AUDIO_AC3 to "ac3",
    MimeTypes.AUDIO_E_AC3 to "eac3",
    MimeTypes.AUDIO_DTS to "dts",
    MimeTypes.AUDIO_TRUEHD to "truehd",
)

// Многоканальные форматы, которые ТВ или ресивер могут взять по HDMI как есть
private val PASSTHROUGH = listOf(
    MimeTypes.AUDIO_AC3,
    MimeTypes.AUDIO_E_AC3,
    MimeTypes.AUDIO_DTS,
    MimeTypes.AUDIO_TRUEHD,
)

// Звук, который TsExtractor Media3 берёт из сегментов MPEG-TS как есть:
// сервер копирует его в HLS вместо перекодирования в AAC
private val HLS_COPY_AUDIO = setOf("aac", "mp3", "ac3", "eac3", "dts")

// Контейнеры, которые Media3 разбирает сам; AVI — через перепаковку сервера
private val CONTAINERS = listOf("mp4", "mkv", "webm", "ts")

/**
 * Профиль для `POST /playback` из того, что умеет приставка: видео и звук —
 * по декодерам `MediaCodecList`, многоканальный звук — ещё и по passthrough
 * на HDMI. Сервер по нему решает, играть файл напрямую или перепаковать.
 */
fun deviceProfileJson(videoMimes: Set<String>, audioMimes: Set<String>): JSONObject {
    val audio = AUDIO_CODECS.filterKeys(audioMimes::contains).values.toList()

    return JSONObject()
        .put("containers", JSONArray(CONTAINERS))
        .put("video", JSONArray(VIDEO_CODECS.filterKeys(videoMimes::contains).values.toList()))
        .put("audio", JSONArray(audio))
        .put("hlsAudio", JSONArray(audio.filter(HLS_COPY_AUDIO::contains)))
        // Дорожку Media3 переключает сам, без перезапуска потока
        .put("audioTracks", true)
        // Встроенные субтитры показывает слой витрины, их извлекает перепаковка
        .put("embeddedSubtitles", false)
        .put("hls", true)
}

/** MIME-типы, для которых в системе есть декодер */
fun decoderMimes(): Set<String> = MediaCodecList(MediaCodecList.REGULAR_CODECS)
    .codecInfos
    .filterNot { it.isEncoder }
    .flatMap { it.supportedTypes.toList() }
    .map { it.lowercase() }
    .toSet()

/** Многоканальные форматы, которые выход звука принимает без декодирования */
fun passthroughMimes(context: Context): Set<String> {
    val attributes = AudioAttributes.DEFAULT
    val capabilities = AudioCapabilities.getCapabilities(context, attributes, null)

    return PASSTHROUGH.filter { mime ->
        val format = Format.Builder()
            .setSampleMimeType(mime)
            .setChannelCount(6)
            .setSampleRate(48_000)
            .build()
        capabilities.isPassthroughPlaybackSupported(format, attributes)
    }.toSet()
}

fun deviceProfile(context: Context): JSONObject {
    val decoders = decoderMimes()
    return deviceProfileJson(decoders, decoders + passthroughMimes(context))
}
