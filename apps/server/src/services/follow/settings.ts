import type { FollowMode, FollowQualityPreset } from '../../db/schema.ts'
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

export interface FollowSettings {
  /** Раз в сколько минут читать ленты индексаторов; 0 — не читать */
  rssIntervalMin: number
  /** Бюджет фоновых целевых поисков; «Искать сейчас» его не тратит */
  searchesPerHour: number
  /** Правила новых слежений */
  defaults: FollowDefaults
}

export interface FollowSettingsPatch {
  rssIntervalMin?: number
  searchesPerHour?: number
  defaults?: Partial<FollowDefaults>
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
  }

  setSetting(SETTINGS_KEY, next)
  return next
}
