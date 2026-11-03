import type {
  AttentionItem,
  CheckMetadataKeyInput,
  CreateSourcePresetInput,
  ImdbDatasetStatus,
  MessageResponse,
  MetadataKeyCheck,
  MetadataSettings,
  PlaybackSettings,
  SourceSettings,
  ThumbnailSettings,
  TorrentSettings,
  TorrentSettingValues,
  UpdateImdbSettingsInput,
  UpdateMetadataSettingsInput,
  UpdatePlaybackSettingsInput,
  UpdateSourcePresetInput,
  UpdateSourceSettingsInput,
  UpdateThumbnailSettingsInput,
  UpdateTorrentSettingsInput,
} from '@torsher/api-client'
import { del, DemoError, get, patch, post, put } from '@torsher/demo/router'
import {
  ago,
  DAY,
  elapsedSeconds,
  HOUR,
  isFresh,
  MB,
} from '@torsher/demo/state'

// --- Метаданные ---

// Ключ из панели или ключ приложения, с которым собран образ
let tmdbSource: MetadataSettings['tmdb']['source'] = isFresh ? 'app' : 'custom'

// Выгрузка IMDb качается в фоне несколько секунд: опрос панели видит конец
const IMDB_UPDATE_SECONDS = 6
const IMDB_COUNT = 1_582_417

let imdbEnabled = !isFresh
let imdbHasData = !isFresh
let imdbUpdatedAt = ago(2 * DAY + 3 * HOUR)
let imdbCheckedAt = ago(5 * HOUR)
let imdbUpdateStartedAt: number | undefined

/** IMDb включён: «О программе» показывает его атрибуцию, как на сервере */
export function isImdbEnabled() {
  return imdbEnabled
}

function imdbStatus(): ImdbDatasetStatus {
  if (
    imdbUpdateStartedAt !== undefined
    && elapsedSeconds() - imdbUpdateStartedAt >= IMDB_UPDATE_SECONDS
  ) {
    imdbUpdateStartedAt = undefined
    imdbHasData = true
    imdbUpdatedAt = ago(0)
    imdbCheckedAt = imdbUpdatedAt
  }

  if (!imdbEnabled)
    return { enabled: false, state: 'off' }

  return {
    enabled: true,
    state:
      imdbUpdateStartedAt !== undefined
        ? 'updating'
        : imdbHasData
          ? 'ready'
          : 'empty',
    updatedAt: imdbHasData ? imdbUpdatedAt : undefined,
    checkedAt: imdbHasData ? imdbCheckedAt : undefined,
    count: imdbHasData ? IMDB_COUNT : undefined,
  }
}

function metadataSettings(): MetadataSettings {
  return {
    tmdb: { source: tmdbSource, defaultKey: 'app' },
    imdb: imdbStatus(),
  }
}

get<MetadataSettings>('/api/settings/metadata', () => metadataSettings())

put<MetadataSettings, UpdateMetadataSettingsInput>(
  '/api/settings/metadata',
  ({ body }) => {
    tmdbSource = body.tmdbKey ? 'custom' : 'app'

    return metadataSettings()
  },
)

// Наружу демо не ходит: ключ подходящей длины считаем принятым
post<MetadataKeyCheck, CheckMetadataKeyInput>(
  '/api/settings/metadata/check',
  ({ body }) => {
    const key = body?.tmdbKey?.trim()

    if (key !== undefined && key.length < 16)
      return { ok: false, kind: 'rejected' }

    return { ok: true, kind: null }
  },
)

put<ImdbDatasetStatus, UpdateImdbSettingsInput>(
  '/api/settings/metadata/imdb',
  ({ body }) => {
    imdbEnabled = body.enabled

    if (body.enabled) {
      imdbUpdateStartedAt = elapsedSeconds()
    }
    else {
      // Выключение удаляет выгрузку, как на сервере
      imdbUpdateStartedAt = undefined
      imdbHasData = false
    }

    return imdbStatus()
  },
)

post<ImdbDatasetStatus>('/api/settings/metadata/imdb/refresh', () => {
  if (!imdbEnabled)
    throw new DemoError(409, { message: 'IMDb ratings are off' })

  imdbUpdateStartedAt ??= elapsedSeconds()

  return imdbStatus()
})

// --- Воспроизведение ---

let accel: PlaybackSettings['accel'] = 'auto'
let accelCheckedAt = ago(3 * DAY)

export function playbackSettings(): PlaybackSettings {
  return {
    accel,
    encoder: accel === 'auto' ? 'vaapi' : 'software',
    gpus: [
      {
        encoder: 'vaapi',
        device: '/dev/dri/renderD128',
        name: 'Intel UHD Graphics 770',
        vendor: 'intel',
        lowPower: true,
        decode: ['h264', 'hevc', 'hevc10', 'vp9', 'av1'],
      },
    ],
    failed: [],
    software: true,
    softwareFps: 41,
    softwareMaxHeight: 720,
    gpuToneMapping: true,
    softwareToneMapping: true,
    toneMappingFps: 96,
    toneMappingMaxHeight: 1080,
    checkedAt: accelCheckedAt,
  }
}

/**
 * Причины «Требует внимания» из настроек. Ключ TMDB принят, видеокарта
 * прошла пробу — в демо их нет, но набор тот же, что у сервера
 */
export function settingsAttention(): AttentionItem[] {
  const playback = playbackSettings()

  if (playback.gpus.length > 0 || playback.failed.length === 0)
    return []

  return [
    {
      kind: 'media_accel_failed',
      severity: 'warning',
      section: 'playback',
      params: {},
    },
  ]
}

get<PlaybackSettings>('/api/settings/playback', () => playbackSettings())

put<PlaybackSettings, UpdatePlaybackSettingsInput>(
  '/api/settings/playback',
  ({ body }) => {
    accel = body.accel

    return playbackSettings()
  },
)

post<PlaybackSettings>('/api/settings/playback/check', async () => {
  // Проба видеокарты и замер процессора на сервере занимают секунды
  await new Promise(resolve => setTimeout(resolve, 1500))
  accelCheckedAt = ago(0)

  return playbackSettings()
})

// --- Торрент ---

type TorrentKey = TorrentSettings['custom'][number]
type RestartKey = TorrentSettings['pendingRestart'][number]

const RESTART_KEYS: RestartKey[] = [
  'peerPort',
  'upnp',
  'dht',
  'pex',
  'encryption',
]

const torrentDefaults: TorrentSettingValues = {
  downloadLimit: 0,
  uploadLimit: 0,
  activeDownloads: 3,
  seedRule: { mode: 'always' },
  seedCache: true,
  connsPerTorrent: 50,
  connsTotal: 200,
  peerPort: 51837,
  upnp: false,
  dht: true,
  pex: true,
  encryption: 'prefer',
}

// Поля, которые владелец сохранил сам; остальные — умолчания
const customTorrent: Partial<TorrentSettingValues> = isFresh
  ? {}
  : {
      uploadLimit: 4 * MB,
      activeDownloads: 4,
      seedRule: { mode: 'ratio', ratio: 2 },
    }

function torrentValues(): TorrentSettingValues {
  return { ...torrentDefaults, ...customTorrent }
}

// Сетевые настройки, с которыми запущен движок: остальные ждут перезапуска
let engineNetwork = torrentValues()

function torrentSettings(): TorrentSettings {
  const values = torrentValues()

  return {
    values,
    defaults: torrentDefaults,
    custom: Object.keys(customTorrent) as TorrentKey[],
    peerPortEnv: null,
    pendingRestart: RESTART_KEYS.filter(
      key => values[key] !== engineNetwork[key],
    ),
    restartBlocked: null,
    activeStreams: 0,
  }
}

get<TorrentSettings>('/api/settings/torrent', () => torrentSettings())

put<TorrentSettings, UpdateTorrentSettingsInput>(
  '/api/settings/torrent',
  ({ body }) => {
    Object.assign(customTorrent, body)

    return torrentSettings()
  },
)

function restartEngine(): MessageResponse {
  engineNetwork = torrentValues()

  return { message: 'Engine restarting' }
}

post<MessageResponse>('/api/settings/torrent/restart', restartEngine)
post<MessageResponse>('/api/engine/restart', restartEngine)

let thumbnailsAutomatic = true
let thumbnailStartedAt: number | undefined
function thumbnailStatus(): ThumbnailSettings {
  const completed
    = thumbnailStartedAt === undefined
      ? 0
      : Math.min(10, Math.floor((Date.now() - thumbnailStartedAt) / 500))
  return {
    automatic: thumbnailsAutomatic,
    running: thumbnailStartedAt !== undefined && completed < 10,
    total: thumbnailStartedAt === undefined ? 0 : 10,
    completed,
    generated: completed,
  }
}
get<ThumbnailSettings>('/api/settings/thumbnails', thumbnailStatus)
put<ThumbnailSettings, UpdateThumbnailSettingsInput>(
  '/api/settings/thumbnails',
  ({ body }) => {
    thumbnailsAutomatic = body.automatic
    return thumbnailStatus()
  },
)
post<ThumbnailSettings>('/api/settings/thumbnails/regenerate', () => {
  if (!thumbnailStatus().running)
    thumbnailStartedAt = Date.now()
  return thumbnailStatus()
})

let sourceSettings: SourceSettings = {
  defaultPresetId: 'default-1080p',
  presets: [
    {
      id: 'default-1080p',
      name: '1080p',
      qualities: ['1080p', '2160p', '720p', 'SD'],
      audioLanguages: ['original'],
      voiceTypes: ['D', 'MVO', 'DVO', 'AVO', 'VO', 'L'],
    },
    {
      id: 'default-4k',
      name: '4K',
      qualities: ['2160p', '1080p', '720p', 'SD'],
      audioLanguages: ['original'],
      voiceTypes: ['D', 'MVO', 'DVO', 'AVO', 'VO', 'L'],
    },
  ],
}
let presetCounter = 0
get<SourceSettings>('/api/settings/sources', () => sourceSettings)
put<SourceSettings, UpdateSourceSettingsInput>(
  '/api/settings/sources',
  ({ body }) => {
    sourceSettings = {
      ...sourceSettings,
      defaultPresetId: body.defaultPresetId,
    }
    return sourceSettings
  },
)
post<SourceSettings, CreateSourcePresetInput>(
  '/api/settings/sources/presets',
  ({ body }) => {
    const current = sourceSettings.presets.find(
      item => item.id === sourceSettings.defaultPresetId,
    )!
    sourceSettings = {
      ...sourceSettings,
      presets: [
        ...sourceSettings.presets,
        { ...current, id: `preset-${++presetCounter}`, name: body.name },
      ],
    }
    return sourceSettings
  },
)
patch<SourceSettings, UpdateSourcePresetInput>(
  '/api/settings/sources/presets/:presetId',
  ({ body, params }) => {
    const { makeDefault, ...changes } = body
    sourceSettings = {
      ...sourceSettings,
      defaultPresetId: makeDefault
        ? params.presetId!
        : sourceSettings.defaultPresetId,
      presets: sourceSettings.presets.map(item =>
        item.id === params.presetId ? { ...item, ...changes } : item,
      ),
    }
    return sourceSettings
  },
)
del<SourceSettings>('/api/settings/sources/presets/:presetId', ({ params }) => {
  if (params.presetId === sourceSettings.defaultPresetId)
    throw new DemoError(409, { message: 'Choose another default first' })
  sourceSettings = {
    ...sourceSettings,
    presets: sourceSettings.presets.filter(
      item => item.id !== params.presetId,
    ),
  }
  return sourceSettings
})
