import { invalidateVoicePicks } from '../follow/invalidation.ts'
import type { FollowAudio } from '../../db/schema.ts'
import { randomUUID } from 'node:crypto'
import type { VideoClass, VoiceType } from '@torsher/release-parser'
import { and, inArray, isNotNull, isNull, ne } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { followEpisodes, follows } from '../../db/schema.ts'
import { followSettings } from '../follow/settings.ts'
import { getSetting, setSetting } from '../settings/index.ts'

/** Как ранжировать раздачи. Общий профиль сервера, настраивается владельцем. */
export interface RankingProfile {
  /** Лестница качества с откатом: первое — лучшее. */
  qualities: VideoClass[]
  /** Языки по убыванию предпочтения; original — язык оригинала тайтла. */
  audioLanguages?: FollowAudio[]
  /** Типы перевода по убыванию предпочтения внутри одного языка. */
  voiceTypes: VoiceType[]
}

export interface SourceProfile extends RankingProfile {
  audioLanguages: FollowAudio[]
  voiceTypes: Exclude<VoiceType, 'Original'>[]
}

export const DEFAULT_PROFILE: SourceProfile = {
  qualities: ['1080p', '2160p', '720p', 'SD'],
  audioLanguages: ['original'],
  voiceTypes: ['D', 'MVO', 'DVO', 'AVO', 'VO', 'L'],
}

/** Озвучка, закреплённая за сезоном: студия, а без неё — тип перевода */
export interface VoiceRef {
  studio?: string
  type?: VoiceType
}

const SETTINGS_KEY = 'sources.profile'

export interface SourcePreset extends SourceProfile {
  id: string
  name: string
}

export interface SourceSettings {
  defaultPresetId: string
  presets: SourcePreset[]
}

export function legacyAudioLanguages(audio: FollowAudio): FollowAudio[] {
  return audio === 'original' ? [audio] : [audio, 'original']
}

/** Legacy scalar audio is resolved once when old settings are read, never used by new presets. */
export function sourceSettings(): SourceSettings {
  type LegacyProfile = Omit<SourceProfile, 'audioLanguages'> & {
    audio?: FollowAudio | null
    audioLanguages?: FollowAudio[]
  }
  const stored = getSetting<
    | {
      defaultPresetId: string
      presets: (LegacyProfile & { id: string, name: string })[]
    }
    | LegacyProfile
  >(SETTINGS_KEY)
  const languagesOf = (profile: LegacyProfile): FollowAudio[] =>
    profile.audioLanguages
    ?? legacyAudioLanguages(
      profile.audio ?? followSettings().audio?.value ?? 'original',
    )
  if (stored && 'presets' in stored) {
    return {
      defaultPresetId: stored.defaultPresetId,
      presets: stored.presets.map(({ audio: _audio, ...preset }) => ({
        ...preset,
        audioLanguages: languagesOf({ ...preset, audio: _audio }),
      })),
    }
  }
  const initial = stored ?? {
    ...DEFAULT_PROFILE,
    audioLanguages: legacyAudioLanguages(
      followSettings().audio?.value ?? 'original',
    ),
  }
  return {
    defaultPresetId: 'default-1080p',
    presets: [
      {
        id: 'default-1080p',
        name: '1080p',
        qualities: [
          ...initial.qualities,
          ...DEFAULT_PROFILE.qualities.filter(
            value => !initial.qualities.includes(value),
          ),
        ],
        audioLanguages: languagesOf(initial),
        voiceTypes: [...initial.voiceTypes],
      },
      {
        id: 'default-4k',
        name: '4K',
        qualities: ['2160p', '1080p', '720p', 'SD'],
        audioLanguages: [...languagesOf(initial)],
        voiceTypes: [...DEFAULT_PROFILE.voiceTypes],
      },
    ],
  }
}

function defaultOf(settings: SourceSettings) {
  return settings.presets.find(
    preset => preset.id === settings.defaultPresetId,
  )!
}

export function sourceProfile(): SourceProfile {
  const { qualities, voiceTypes, audioLanguages } = defaultOf(sourceSettings())
  return { qualities, voiceTypes, audioLanguages }
}

/** Порядок и список для витрины берутся из одного снимка настроек. */
export function resolveSourcePreset(presetId?: string) {
  const settings = sourceSettings()
  const selected
    = settings.presets.find(preset => preset.id === presetId)
      ?? defaultOf(settings)
  return {
    profile: {
      qualities: selected.qualities,
      voiceTypes: selected.voiceTypes,
      audioLanguages: selected.audioLanguages,
    },
    presets: {
      defaultId: settings.defaultPresetId,
      effectiveId: selected.id,
      items: settings.presets.map(({ id, name }) => ({ id, name })),
    },
  }
}

export class SourcePresetError extends Error {
  readonly status: 404 | 409
  constructor(status: 404 | 409, message: string) {
    super(message)
    this.status = status
  }
}

function findPreset(settings: SourceSettings, id: string) {
  const preset = settings.presets.find(item => item.id === id)
  if (!preset)
    throw new SourcePresetError(404, 'Preset not found')
  return preset
}

export function createSourcePreset(name: string): SourceSettings {
  const settings = sourceSettings()
  const current = defaultOf(settings)
  return saveSourceSettings({
    ...settings,
    presets: [
      ...settings.presets,
      {
        id: randomUUID(),
        name,
        audioLanguages: [...current.audioLanguages],
        qualities: [...current.qualities],
        voiceTypes: [...current.voiceTypes],
      },
    ],
  })
}

export function updateSourcePreset(
  id: string,
  patch: Partial<SourceProfile> & { name?: string, makeDefault?: boolean },
): SourceSettings {
  const settings = sourceSettings()
  findPreset(settings, id)
  const { makeDefault, ...changes } = patch
  return saveSourceSettings({
    ...settings,
    defaultPresetId: makeDefault ? id : settings.defaultPresetId,
    presets: settings.presets.map(preset =>
      preset.id === id ? { ...preset, ...changes } : preset,
    ),
  })
}

export function setDefaultSourcePreset(id: string): SourceSettings {
  const settings = sourceSettings()
  findPreset(settings, id)
  return saveSourceSettings({ ...settings, defaultPresetId: id })
}

export function deleteSourcePreset(id: string): SourceSettings {
  const settings = sourceSettings()
  findPreset(settings, id)
  if (id === settings.defaultPresetId || settings.presets.length === 1) {
    throw new SourcePresetError(
      409,
      'Choose another default before deleting this preset',
    )
  }
  return saveSourceSettings({
    ...settings,
    presets: settings.presets.filter(preset => preset.id !== id),
  })
}

/** Внутренний patch текущего дефолта; публичный API меняет пресет по ID. */
export function saveSourceProfile(
  patch: Partial<SourceProfile>,
): SourceProfile {
  updateSourcePreset(sourceSettings().defaultPresetId, patch)
  return sourceProfile()
}

export function sameSourceProfile(a: SourceProfile, b: SourceProfile) {
  return (
    a.audioLanguages.join(',') === b.audioLanguages.join(',')
    && a.qualities.join(',') === b.qualities.join(',')
    && a.voiceTypes.join(',') === b.voiceTypes.join(',')
  )
}

/** Сохранение и отмена старых ожидающих решений атомарны; окно не начинается заново. */
function saveSourceSettings(next: SourceSettings): SourceSettings {
  const current = sourceSettings()
  const before = defaultOf(current)
  const after = defaultOf(next)
  const affected = (follow: { audio: FollowAudio | null }) => {
    const oldAudio = follow.audio ? [follow.audio] : before.audioLanguages
    const newAudio = follow.audio ? [follow.audio] : after.audioLanguages
    return (
      before.qualities.join(',') !== after.qualities.join(',')
      || oldAudio.join(',') !== newAudio.join(',')
      || before.voiceTypes.join(',') !== after.voiceTypes.join(',')
    )
  }

  getDb().transaction((db) => {
    setSetting(SETTINGS_KEY, next)
    const unfinished = db
      .select({ id: follows.id, audio: follows.audio })
      .from(follows)
      .where(ne(follows.state, 'done'))
      .all()
      .filter(affected)
      .map(row => row.id)
    // Завершённые слежения и уже выбранные/захваченные результаты сохраняются.
    if (!unfinished.length)
      return
    db.update(followEpisodes)
      .set({ pending: null, waitUntil: null, stateNote: null })
      .where(
        and(
          inArray(followEpisodes.followId, unfinished),
          isNotNull(followEpisodes.pending),
          isNull(followEpisodes.torrentId),
        ),
      )
      .run()
    db.update(follows)
      .set({ lastSearchAt: null, nextSearchAt: null })
      .where(inArray(follows.id, unfinished))
      .run()
  })
  for (const follow of getDb().select().from(follows).all().filter(affected))
    invalidateVoicePicks(follow)
  return next
}
