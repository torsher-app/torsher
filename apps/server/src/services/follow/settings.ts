import type {
  FollowAudio,
  FollowMode,
  FollowQualityPreset,
} from '../../db/schema.ts'
import { getSetting, setSetting } from '../settings/index.ts'

const SETTINGS_KEY = 'follow'

/** `auto` — нужна у тайтлов с нерусским оригиналом */
export type RequireRussianDefault = 'auto' | 'always' | 'never'

export interface FollowDefaults {
  waitHours: number
  /** У фильма своё окно: дубляж выходит позже первых русских релизов */
  movieWaitHours: number
  qualityPreset: FollowQualityPreset
  requireRussian: RequireRussianDefault
  mode: FollowMode
}

/**
 * Язык озвучки сервера: `auto` — подобран по языку браузера первого
 * запроса, `user` — выбран владельцем, подбор его больше не трогает
 */
export interface ServerAudio {
  value: FollowAudio
  source: 'auto' | 'user'
}

export interface FollowSettings {
  /** Раз в сколько минут читать ленты индексаторов; 0 — не читать */
  rssIntervalMin: number
  /** Бюджет фоновых целевых поисков; «Искать сейчас» его не тратит */
  searchesPerHour: number
  /** Правила новых слежений */
  defaults: FollowDefaults
  /** Нет — сервер ещё не знает языка зрителей */
  audio?: ServerAudio
}

export interface FollowSettingsPatch {
  rssIntervalMin?: number
  searchesPerHour?: number
  defaults?: Partial<FollowDefaults>
  audio?: ServerAudio
}

export const DEFAULT_FOLLOW_SETTINGS: FollowSettings = {
  rssIntervalMin: 15,
  searchesPerHour: 20,
  defaults: {
    waitHours: 24,
    movieWaitHours: 72,
    qualityPreset: 'best',
    requireRussian: 'auto',
    mode: 'download',
  },
}

type StoredSettings = Partial<Omit<FollowSettings, 'defaults'>> & {
  defaults?: Partial<FollowDefaults>
}

/** Сохранённое поверх умолчаний: поля, которых в базе нет, — по умолчанию */
export function followSettings(): FollowSettings {
  const stored = getSetting<StoredSettings>(SETTINGS_KEY) ?? {}

  return {
    ...DEFAULT_FOLLOW_SETTINGS,
    ...stored,
    defaults: { ...DEFAULT_FOLLOW_SETTINGS.defaults, ...stored.defaults },
  }
}

export function saveFollowSettings(patch: FollowSettingsPatch) {
  const current = followSettings()
  const next: FollowSettings = {
    rssIntervalMin: patch.rssIntervalMin ?? current.rssIntervalMin,
    searchesPerHour: patch.searchesPerHour ?? current.searchesPerHour,
    defaults: { ...current.defaults, ...patch.defaults },
    ...((patch.audio ?? current.audio) && {
      audio: patch.audio ?? current.audio,
    }),
  }

  setSetting(SETTINGS_KEY, next)
  return next
}

/** Настройки для API: язык озвучки, которого нет, — `null` */
export function followSettingsView(settings: FollowSettings) {
  return { ...settings, audio: settings.audio ?? null }
}
