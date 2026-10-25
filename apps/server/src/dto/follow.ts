import { z } from 'zod'
import {
  followQualityPresets,
  followStates,
  profileColors,
} from '../db/schema.ts'
import {
  followCursor,
  followEpisodeStates,
  titleNextEpisode,
  tmdbLanguage,
} from './catalog.ts'

export const followParams = z.object({
  id: z.string().min(1).max(100),
})

export const followLanguageQuery = z.object({
  // Язык деталей TMDB: по ним считаются сезоны и курсор, кэш общий с карточкой
  language: tmdbLanguage,
})

const cursorRef = z.object({
  season: z.number().int().min(1).max(999),
  episode: z.number().int().min(1).max(9999),
})

// «Только новые серии», «С текущего сезона», «С начала сериала»
const cursorPresets = ['new', 'season', 'beginning'] as const

const rules = {
  // Студия, если за сезоном не закреплена своя; null — без студии
  voiceStudio: z.string().trim().min(1).max(100).nullable().optional(),
  // Другую студию не брать совсем
  voiceStrict: z.boolean().optional(),
  requireRussian: z.boolean().optional(),
  // Ждать свою озвучку и верхнюю ступень качества, часов
  waitHours: z.number().int().min(0).max(168).optional(),
  qualityPreset: z.enum(followQualityPresets).optional(),
}

export const followTitle = z
  .object({
    ...rules,
    // `auto` — по просмотрам профиля; без поля курсор не меняется, у нового
    // слежения — `auto`
    start: z.union([z.enum(['auto', ...cursorPresets]), cursorRef]).optional(),
  })
  .meta({ id: 'followTitle' })

export const updateFollow = z
  .object({
    ...rules,
    start: z.union([z.enum(cursorPresets), cursorRef]).optional(),
    state: z.enum(['active', 'paused']).optional(),
  })
  .meta({ id: 'updateFollow' })

const followView = {
  id: z.string(),
  kind: z.enum(['movie', 'series']),
  state: z.enum(followStates),
  start: followCursor,
  voiceStudio: z.string().nullable(),
  voiceStrict: z.boolean(),
  requireRussian: z.boolean(),
  waitHours: z.number().int(),
  qualityPreset: z.enum(followQualityPresets),
  // Ближайшая невышедшая серия с курсора; у фильма и без анонса — null
  next: titleNextEpisode.nullable(),
}

export const titleFollow = z
  .object({
    ...followView,
    subscribed: z.boolean(),
    profileCount: z.number().int(),
  })
  .meta({ id: 'titleFollow' })

export const titleFollowResponse = z
  .object({
    follow: titleFollow.nullable(),
    // Профиль может менять правила: без возрастного порога или владелец
    canEdit: z.boolean(),
    // Только у сериала: куда встанет курсор у пресетов «С какой серии»
    options: z
      .object({
        new: followCursor,
        season: followCursor,
        beginning: followCursor,
      })
      .nullable(),
  })
  .meta({ id: 'titleFollowResponse' })

export const followProfile = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.enum(profileColors),
  })
  .meta({ id: 'followProfile' })

export const followEpisode = z
  .object({
    season: z.number().int(),
    episode: z.number().int(),
    // YYYY-MM-DD; у серий из числа вышедших и без анонса даты нет
    airDate: z.string().optional(),
    state: z.enum(followEpisodeStates),
    // До какого момента ждём лучший кандидат, ISO; только у `waiting`
    waitUntil: z.string().optional(),
  })
  .meta({ id: 'followEpisode' })

export const followSummary = z
  .object({
    ...followView,
    titleId: z.string(),
    // Детали TMDB не загрузились — тайтл без названия и постера
    title: z.string().nullable(),
    poster: z.string().optional(),
    year: z.number().int().optional(),
    profiles: z.array(followProfile),
    // Вышедших серий с курсора, которых нет в библиотеке и которые не качаются
    wanted: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'followSummary' })

export const followListResponse = z
  .object({ items: z.array(followSummary) })
  .meta({ id: 'followListResponse' })

export const followDetails = followSummary
  .extend({ episodes: z.array(followEpisode) })
  .meta({ id: 'followDetails' })

export const scheduleItem = z
  .object({
    titleId: z.string(),
    title: z.string(),
    season: z.number().int(),
    episode: z.number().int(),
    episodeTitle: z.string().optional(),
    // YYYY-MM-DD
    airDate: z.string(),
    // Кадр серии, без него — бэкдроп тайтла
    image: z.string().optional(),
    // Профиль следит за тайтлом
    followed: z.boolean(),
    // Состояние серии «Следить»; null — серия до курсора или тайтл не в слежении
    state: z.enum(followEpisodeStates).nullable(),
  })
  .meta({ id: 'scheduleItem' })

export const scheduleResponse = z
  .object({
    // Ближайшие по дате выхода, раньше — первыми
    upcoming: z.array(scheduleItem),
    // Вышедшие за 14 дней, свежие — первыми
    recent: z.array(scheduleItem),
  })
  .meta({ id: 'scheduleResponse' })

export type TitleFollowResponse = z.output<typeof titleFollowResponse>
export type FollowSummary = z.output<typeof followSummary>
export type FollowDetails = z.output<typeof followDetails>
export type ScheduleItem = z.output<typeof scheduleItem>
