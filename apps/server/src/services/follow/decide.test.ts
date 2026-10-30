import type { TitleMatch } from '@torsher/release-parser'
import type { VoiceRef } from '../sources/profile.ts'
import type { FoundRelease } from '../sources/rank.ts'
import type { BlockedReleases } from './blocklist.ts'
import type { DecideContext, SeasonContext } from './decide.ts'
import { parseRelease } from '@torsher/release-parser'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE } from '../sources/profile.ts'
import { rankReleases } from '../sources/rank.ts'
import {
  bestQualitySeen,
  checkCandidate,
  cutoffStepOf,
  planSeason,
} from './decide.ts'
import { listedKey } from './blocklist.ts'
import { ladderStep } from './rank.ts'
import { isUpgrade } from './upgrade.ts'
import { episodeKey, episodeStates, wantedEpisodes } from './wanted.ts'

const GB = 1024 ** 3
const HOUR_MS = 60 * 60 * 1000
const NOW = new Date('2026-10-20T12:00:00')
const high: TitleMatch = { confidence: 'high', issues: [] }
const LOSTFILM: VoiceRef = { studio: 'LostFilm' }

function found(
  id: string,
  title: string,
  extra: Partial<FoundRelease> = {},
): FoundRelease {
  return {
    id,
    title,
    indexers: [{ id: 'ix', name: 'Indexer A' }],
    seeders: 20,
    size: 1.5 * GB,
    infoHash: id.padEnd(40, '0'),
    parsed: parseRelease(title),
    match: high,
    ...extra,
  }
}

/** Серия второго сезона синтетического шоу */
function episode(
  number: number,
  tail: string,
  extra: Partial<FoundRelease> = {},
) {
  return found(
    `e${number}-${tail}`,
    `Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: ${number} из 12 (2024) ${tail}`,
    extra,
  )
}

function ranked(releases: FoundRelease[], pinned?: VoiceRef) {
  return rankReleases(releases, {
    kind: 'series',
    profile: DEFAULT_PROFILE,
    pinned,
    episodeCounts: { 2: 12 },
  }).ranked
}

function keys(...numbers: number[]) {
  return new Set(
    numbers.map(number => episodeKey({ season: 2, episode: number })),
  )
}

function noBlocks(): BlockedReleases {
  return { hashes: new Map(), listed: new Map() }
}

function context(overrides: Partial<DecideContext> = {}): DecideContext {
  return {
    kind: 'series',
    preset: 'best',
    voiceStrict: false,
    requireRussian: true,
    waitHours: 24,
    russianOriginal: false,
    profile: DEFAULT_PROFILE,
    episodeCounts: { 2: 12 },
    wanted: keys(5),
    downloading: new Set(),
    blocked: noBlocks(),
    firstSeen: new Map(),
    now: NOW,
    ...overrides,
  }
}

const season2: SeasonContext = { season: 2, voice: LOSTFILM, cutoffStep: 0 }

function plan(
  releases: FoundRelease[],
  ctx: Partial<DecideContext> = {},
  season: SeasonContext = season2,
) {
  return planSeason(ranked(releases, season.voice), season, context(ctx))
}

function grabbed(result: ReturnType<typeof plan>) {
  return result.grabs.map(item => ({
    id: item.candidate.release.id,
    episodes: item.episodes.map(ref => ref.episode),
  }))
}

function codes(result: ReturnType<typeof plan>, id: string) {
  return result.candidates
    .find(item => item.release.id === id)
    ?.rejections
    .map(item => item.code)
}

describe('решатель «Следить»', () => {
  it('своя студия в верхней ступени качается сразу', () => {
    const result = plan([episode(5, 'WEB-DL 1080p | LostFilm')])

    expect(grabbed(result)).toEqual([
      { id: 'e5-WEB-DL 1080p | LostFilm', episodes: [5] },
    ])
    expect(result.pending).toEqual([])
    expect([...result.found.keys()]).toEqual(['2:5'])
  })

  it('чужая студия откладывается до конца окна от первого появления', () => {
    const other = episode(5, 'WEB-DL 1080p | NewStudio')
    const first = plan([other])

    expect(first.grabs).toEqual([])
    expect(first.pending).toHaveLength(1)
    expect(first.pending[0]!.until).toEqual(
      new Date(NOW.getTime() + 24 * HOUR_MS),
    )
    expect(first.candidates[0]!.rejections).toEqual([
      {
        code: 'wait',
        type: 'temporary',
        params: {
          until: new Date(NOW.getTime() + 24 * HOUR_MS).toISOString(),
          studio: 'LostFilm',
        },
      },
    ])

    // Таймер идёт от первого появления, а не от прогона
    const seen = new Map([['2:5', NOW]])
    const later = plan([other], {
      firstSeen: seen,
      now: new Date(NOW.getTime() + 23 * HOUR_MS),
    })

    expect(later.grabs).toEqual([])
    expect(later.found.size).toBe(0)

    const after = plan([other], {
      firstSeen: seen,
      now: new Date(NOW.getTime() + 24 * HOUR_MS),
    })

    expect(grabbed(after)).toEqual([{ id: other.id, episodes: [5] }])
  })

  it('своя студия, пришедшая во время окна, берётся сразу', () => {
    const result = plan(
      [
        episode(5, 'WEB-DL 1080p | NewStudio', { seeders: 300 }),
        episode(5, 'WEB-DL 1080p | LostFilm', { seeders: 3 }),
      ],
      { firstSeen: new Map([['2:5', new Date(NOW.getTime() - HOUR_MS)]]) },
    )

    expect(grabbed(result)).toEqual([
      { id: 'e5-WEB-DL 1080p | LostFilm', episodes: [5] },
    ])
    expect(codes(result, 'e5-WEB-DL 1080p | NewStudio')).toEqual(['outranked'])
  })

  it('окно кончилось: пришедший в тот же проход не обходит отложенного', () => {
    const waited = episode(5, 'WEB-DL 1080p | NewStudio')
    const late = episode(5, 'WEB-DL 720p | NewStudio', { seeders: 300 })
    const expired = {
      firstSeen: new Map([['2:5', new Date(NOW.getTime() - 24 * HOUR_MS)]]),
    }

    for (const releases of [
      [waited, late],
      [late, waited],
    ]) {
      const result = plan(releases, expired)

      expect(grabbed(result)).toEqual([{ id: waited.id, episodes: [5] }])
      expect(codes(result, late.id)).toEqual(['outranked'])
    }

    // Лучший пришедший берётся по тому же порядку, а не потому что последний
    const better = episode(5, 'WEB-DL 1080p | LostFilm', { seeders: 3 })

    expect(grabbed(plan([waited, better], expired))).toEqual([
      { id: better.id, episodes: [5] },
    ])
  })

  it('строго своя студия: чужую не берём и после окна, окно — только на качество', () => {
    const result = plan(
      [
        episode(5, 'WEB-DL 1080p | NewStudio'),
        episode(5, 'WEB-DL 720p | LostFilm'),
      ],
      {
        voiceStrict: true,
        firstSeen: new Map([['2:5', new Date(NOW.getTime() - 2 * HOUR_MS)]]),
      },
    )

    expect(codes(result, 'e5-WEB-DL 1080p | NewStudio')).toEqual([
      'voice_strict',
    ])
    expect(result.grabs).toEqual([])
    expect(result.pending.map(item => item.candidate.release.id)).toEqual([
      'e5-WEB-DL 720p | LostFilm',
    ])
    expect(codes(result, 'e5-WEB-DL 720p | LostFilm')).toEqual(['wait'])
  })

  it('720p-шоу: три серии без 1080p — cutoff опускается, 720p своей студии сразу', () => {
    const releases = [episode(5, 'WEB-DL 720p | LostFilm')]
    const best = bestQualitySeen(ranked(releases), '720p')

    expect(cutoffStepOf('best', best, 2)).toBe(0)
    expect(cutoffStepOf('best', best, 3)).toBe(1)
    expect(cutoffStepOf('best', '1080p', 3)).toBe(0)

    const waiting = plan(releases)

    expect(waiting.grabs).toEqual([])
    expect(waiting.candidates[0]!.rejections[0]!.params).toMatchObject({
      quality: '1080p',
    })

    const lowered = plan(releases, {}, { ...season2, cutoffStep: 1 })

    expect(grabbed(lowered)).toEqual([
      { id: 'e5-WEB-DL 720p | LostFilm', episodes: [5] },
    ])
  })

  it('пак 1–8 из 12 при скачанных 1–5: только 6–8', () => {
    const episodes = Array.from({ length: 12 }, (_, index) => ({
      season: 2,
      episode: index + 1,
      aired: index < 8,
    }))
    const states = episodeStates({
      cursor: { season: 2, episode: 1 },
      episodes,
      library: keys(1, 2, 3, 4, 5),
      downloading: new Set(),
    })
    const wanted = new Set(wantedEpisodes(states).map(episodeKey))
    const pack = found(
      'pack',
      'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 1-8 из 12 (2024) WEB-DL 1080p | LostFilm',
      { size: 12 * GB },
    )
    const result = plan([pack], { wanted })

    expect(grabbed(result)).toEqual([{ id: 'pack', episodes: [6, 7, 8] }])
  })

  it('перед курсором не качаем: курсор на 7-й серии, пак 1–8 даёт 7–8', () => {
    const states = episodeStates({
      cursor: { season: 2, episode: 7 },
      episodes: Array.from({ length: 8 }, (_, index) => ({
        season: 2,
        episode: index + 1,
        aired: true,
      })),
      library: new Set(),
      downloading: new Set(),
    })
    const pack = found(
      'pack',
      'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 1-8 из 12 (2024) WEB-DL 1080p | LostFilm',
      { size: 12 * GB },
    )
    const result = plan([pack], {
      wanted: new Set(wantedEpisodes(states).map(episodeKey)),
    })

    expect(grabbed(result)).toEqual([{ id: 'pack', episodes: [7, 8] }])
  })

  it('жадное покрытие: лучший пак забирает свои серии, одиночная — остальное', () => {
    const pack = found(
      'pack',
      'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 1-3 из 12 (2024) WEB-DL 1080p | LostFilm',
      { size: 4.5 * GB },
    )
    const single = episode(4, 'WEB-DL 1080p | LostFilm')
    const result = plan([single, pack], { wanted: keys(1, 2, 3, 4) })

    expect(grabbed(result)).toEqual([
      { id: 'pack', episodes: [1, 2, 3] },
      { id: single.id, episodes: [4] },
    ])
  })

  it('экранная копия, нет русской дорожки, качество вне лестницы — постоянные отказы', () => {
    const result = plan([
      episode(5, 'TS | LostFilm'),
      episode(5, 'WEB-DL 1080p Eng'),
      episode(5, 'WEB-DL 2160p | LostFilm', { size: 6 * GB }),
    ])

    expect(codes(result, 'e5-TS | LostFilm')).toContain('screen_copy')
    expect(codes(result, 'e5-WEB-DL 1080p Eng')).toEqual(['no_russian'])
    expect(codes(result, 'e5-WEB-DL 2160p | LostFilm')).toEqual(['quality'])
    expect(result.grabs).toEqual([])
    expect(result.pending).toEqual([])
    expect(result.found.size).toBe(0)
  })

  it('озвучка важнее качества: своя студия в 720p выше чужой в 1080p', () => {
    const result = plan(
      [
        episode(5, 'WEB-DL 1080p | NewStudio'),
        episode(5, 'WEB-DL 720p | LostFilm'),
      ],
      {
        now: new Date(NOW.getTime() + 25 * HOUR_MS),
        firstSeen: new Map([['2:5', NOW]]),
      },
    )

    expect(grabbed(result)).toEqual([
      { id: 'e5-WEB-DL 720p | LostFilm', episodes: [5] },
    ])
  })

  it('не уверены в тайтле, чёрный список, нет сидов, уже качается', () => {
    const unsure = episode(5, 'WEB-DL 1080p | LostFilm', {
      id: 'unsure',
      match: { confidence: 'medium', issues: ['year'] },
    })
    const blocked = episode(5, 'WEB-DL 1080p | LostFilm', {
      id: 'blocked',
      infoHash: 'b'.repeat(40),
    })
    const dead = episode(5, 'WEB-DL 1080p | LostFilm', {
      id: 'dead',
      seeders: 0,
    })
    const busy = episode(6, 'WEB-DL 1080p | LostFilm', { id: 'busy' })
    const result = plan([unsure, blocked, dead, busy], {
      blocked: { ...noBlocks(), hashes: new Map([['b'.repeat(40), null]]) },
      downloading: keys(6),
    })

    expect(codes(result, 'unsure')).toEqual(['title_unsure'])
    expect(codes(result, 'blocked')).toEqual(['blocklisted'])
    expect(codes(result, 'dead')).toEqual(['no_seeders'])
    expect(codes(result, 'busy')).toEqual(['already_downloading'])
    expect(result.grabs).toEqual([])
    // Раздача без сидов прошла постоянные проверки: окно серии пошло
    expect([...result.found.keys()]).toEqual(['2:5'])
  })

  it('размер далеко вне коридора серии — отказ', () => {
    const tiny = episode(5, 'WEB-DL 1080p | LostFilm', { size: 0.1 * GB })
    const { candidates } = plan([tiny])

    expect(candidates[0]!.rejections.map(item => item.code)).toEqual([
      'size',
    ])
  })

  it('без своей студии cutoff — лучший тип профиля: многоголосый ждёт дубляж', () => {
    const season = { season: 2, cutoffStep: 0 }
    const mvo = plan([episode(5, 'WEB-DL 1080p | MVO')], {}, season)

    expect(mvo.grabs).toEqual([])
    expect(mvo.candidates[0]!.rejections[0]!.params).toMatchObject({
      voiceType: 'D',
    })
    expect(
      grabbed(plan([episode(5, 'WEB-DL 1080p | D')], {}, season)),
    ).toHaveLength(1)
  })

  it('русский оригинал: озвучка не нужна, качество — по лестнице', () => {
    const result = plan(
      [episode(5, 'WEB-DL 1080p')],
      // У тайтла с русским оригиналом «нужна русская дорожка» выключено
      { russianOriginal: true, requireRussian: false },
      { season: 2, cutoffStep: 0 },
    )

    expect(grabbed(result)).toHaveLength(1)
  })

  it('окно 0 — лучший кандидат сразу', () => {
    const result = plan([episode(5, 'WEB-DL 720p | NewStudio')], {
      waitHours: 0,
    })

    expect(grabbed(result)).toHaveLength(1)
  })

  it('фильм: экранку не берём, цифровой релиз — да', () => {
    const ctx = context({
      kind: 'movie',
      wanted: new Set(['0:0']),
      episodeCounts: undefined,
    })
    const releases = rankReleases(
      [
        found('cam', 'Фонарь (2026) CAMRip | D', { size: 2 * GB }),
        found('web', 'Фонарь (2026) WEB-DL 1080p | D', { size: 8 * GB }),
      ],
      { kind: 'movie', profile: DEFAULT_PROFILE },
    ).ranked
    const result = planSeason(releases, { season: 0, cutoffStep: 0 }, ctx)

    expect(result.grabs.map(item => item.candidate.release.id)).toEqual([
      'web',
    ])
    expect(
      result.candidates.find(item => item.release.id === 'cam')!
        .rejections[0]!.code,
    ).toBe('screen_copy')
  })
})

describe('лестница качества', () => {
  it('неизвестное разрешение — ниже последней ступени, в «4K» — вне лестницы', () => {
    expect(ladderStep('1080p', 'best')).toBe(0)
    expect(ladderStep('SD', 'best')).toBe(2)
    expect(ladderStep(undefined, 'best')).toBe(3)
    expect(ladderStep(undefined, 'compact')).toBe(2)
    expect(ladderStep(undefined, 'uhd')).toBeUndefined()
    expect(ladderStep('2160p', 'best')).toBeUndefined()
  })

  it('раздача без разрешения проходит проверки и ждёт окна', () => {
    const [release] = ranked([episode(5, 'WEB-DL | LostFilm')])
    const checked = checkCandidate(release!, season2, context())

    expect(checked.rejections).toEqual([])
    expect(checked.step).toBe(3)
  })
})

describe('продолжение темы', () => {
  it('раздача из темы сезона выше раздачи, у которой больше сидов', () => {
    const topic = {
      indexerId: 'ix',
      detailsUrl: 'https://tracker.example/topic/1',
    }
    const fromTopic = found(
      'topic',
      'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 1-5 из 12 (2024) WEB-DL 1080p | LostFilm',
      {
        indexers: [
          { id: 'ix', name: 'Indexer A', detailsUrl: topic.detailsUrl },
        ],
        seeders: 5,
        size: 5 * 1.5 * GB,
      },
    )
    const single = episode(5, 'WEB-DL 1080p | LostFilm', { seeders: 500 })

    expect(
      grabbed(plan([single, fromTopic], {}, { ...season2, topic })),
    ).toEqual([{ id: 'topic', episodes: [5] }])
    expect(grabbed(plan([single, fromTopic]))).toEqual([
      { id: single.id, episodes: [5] },
    ])
  })
})

/** Версия файла в библиотеке — как у раздачи с таким названием */
function version(tail: string) {
  return ranked([episode(5, tail)], LOSTFILM)[0]!
}

describe('апгрейд серии в библиотеке', () => {
  const upgrade = (tail: string) =>
    new Map([['2:5', { current: version(tail) }]])

  it('чужую студию после окна своя заменяет сразу, без окна ожидания', () => {
    const own = episode(5, 'WEB-DL 1080p | LostFilm')
    const result = plan([own], {
      wanted: new Set(),
      upgrades: upgrade('WEB-DL 1080p | NewStudio'),
    })

    expect(grabbed(result)).toEqual([{ id: own.id, episodes: [5] }])
    expect(result.found.size).toBe(0)
  })

  it('своя студия ниже ступенью — тоже шаг: озвучка раньше качества', () => {
    const own = episode(5, 'WEB-DL 720p | LostFilm')
    const result = plan([own], {
      wanted: new Set(),
      upgrades: upgrade('WEB-DL 1080p | NewStudio'),
    })

    expect(grabbed(result)).toEqual([{ id: own.id, episodes: [5] }])
  })

  it('чужая студия выше ступенью своей не заменяет — «не лучше скачанной»', () => {
    const other = episode(5, 'WEB-DL 1080p | NewStudio')
    const own = episode(5, 'WEB-DL 1080p | LostFilm')
    const result = plan([other, own], {
      wanted: new Set(),
      upgrades: upgrade('WEB-DL 720p | LostFilm'),
    })

    expect(codes(result, other.id)).toEqual(['not_better'])
    expect(grabbed(result)).toEqual([{ id: own.id, episodes: [5] }])
  })

  it('файл в cutoff не заменяется ничем', () => {
    const own = episode(5, 'WEB-DL 1080p | LostFilm', { seeders: 900 })
    const result = plan([own], {
      wanted: new Set(),
      upgrades: upgrade('WEB-DL 1080p | LostFilm'),
    })

    expect(result.grabs).toEqual([])
    expect(codes(result, own.id)).toEqual(['not_better'])
  })

  it('посмотрели или выбрали вручную — не заменяем', () => {
    const own = episode(5, 'WEB-DL 1080p | LostFilm')
    const blocked = (reason: 'watched' | 'manual') =>
      plan([own], {
        wanted: new Set(),
        upgrades: new Map([['2:5', { blocked: reason }]]),
      })

    expect(codes(blocked('watched'), own.id)).toEqual(['watched'])
    expect(codes(blocked('manual'), own.id)).toEqual(['manual'])
    expect(blocked('watched').grabs).toEqual([])
  })

  it('пак берётся ради нужной серии, а посмотренную рядом не заменяет', () => {
    const pack = found(
      'pack',
      'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 5-6 из 12 (2024) WEB-DL 1080p | LostFilm',
      { size: 3 * GB },
    )
    const result = plan([pack], {
      wanted: keys(6),
      upgrades: new Map([['2:5', { blocked: 'watched' as const }]]),
    })
    const candidate = result.candidates[0]!

    expect(grabbed(result)).toEqual([{ id: 'pack', episodes: [6] }])
    expect(candidate.rejections).toEqual([])
    expect(candidate.episodeRejections.get('2:5')?.code).toBe('watched')
    expect(candidate.considered.map(item => item.episode)).toEqual([5, 6])
  })
})

describe('фильм до цифрового релиза', () => {
  const movie = (id: string, title: string) =>
    found(id, `Сигнал / Signal (2026) ${title}`, { size: 8 * GB })
  const moviePlan = (releases: FoundRelease[], until: Date | null) =>
    planSeason(
      rankReleases(releases, { kind: 'movie', profile: DEFAULT_PROFILE })
        .ranked,
      { season: 0, cutoffStep: 0 },
      context({
        kind: 'movie',
        wanted: new Set(['0:0']),
        waitHours: 72,
        unavailableUntil: until,
      }),
    )
  const date = new Date('2026-12-01T00:00:00')

  it('раздача без цифрового источника ждёт релиза и окна не начинает', () => {
    const unknown = movie('unknown', '1080p | Дубляж')
    const result = moviePlan([unknown], date)

    expect(result.candidates[0]!.rejections).toEqual([
      {
        code: 'not_available',
        type: 'temporary',
        params: { date: date.toISOString() },
      },
    ])
    expect(result.found.size).toBe(0)
    expect(moviePlan([unknown], null).candidates[0]!.rejections[0]).toEqual({
      code: 'not_available',
      type: 'temporary',
    })
  })

  it('раздача из цифры доказывает релиз: окно 3 дня', () => {
    const web = movie('web', 'WEB-DL 1080p | MVO')
    const result = moviePlan([web], date)

    expect(result.candidates[0]!.rejections.map(item => item.code)).toEqual([
      'wait',
    ])
    expect(result.pending[0]!.until).toEqual(
      new Date(NOW.getTime() + 72 * HOUR_MS),
    )
  })

  it('экранка не берётся никогда', () => {
    const cam = movie('cam', 'CAMRip | Дубляж')

    expect(
      moviePlan([cam], date).candidates[0]!.rejections.map(item => item.code),
    ).toEqual(['screen_copy'])
    expect(
      planSeason(
        rankReleases([cam], { kind: 'movie', profile: DEFAULT_PROFILE }).ranked,
        { season: 0, cutoffStep: 0 },
        context({ kind: 'movie', wanted: new Set(['0:0']) }),
      ).candidates[0]!.rejections.map(item => item.code),
    ).toContain('screen_copy')
  })
})

describe('лучше на целый шаг', () => {
  it('озвучка в cutoff сильнее ступени, при той же озвучке — ступень', () => {
    const at = (voiceAtCutoff: boolean, step: number) => ({
      voiceAtCutoff,
      step,
    })

    expect(isUpgrade(at(true, 1), at(false, 0))).toBe(true)
    expect(isUpgrade(at(false, 0), at(true, 1))).toBe(false)
    expect(isUpgrade(at(false, 0), at(false, 1))).toBe(true)
    expect(isUpgrade(at(true, 1), at(true, 1))).toBe(false)
  })
})

describe('чёрный список по сериям', () => {
  const PACK
    = 'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 1-8 из 12 (2024) WEB-DL 1080p | LostFilm'

  it('в паке нет серий 7–8: он берётся за остальные, за 7–8 — нет', () => {
    const blocked = {
      ...noBlocks(),
      hashes: new Map([['p'.padEnd(40, '0'), new Set(['2:7', '2:8'])]]),
    }
    const wanted = keys(5, 6, 7, 8)

    expect(
      grabbed(plan([found('p', PACK, { size: 12 * GB })], { blocked, wanted })),
    ).toEqual([{ id: 'p', episodes: [5, 6] }])

    const rest = plan([found('p', PACK, { size: 12 * GB })], {
      blocked,
      wanted: keys(7, 8),
    })

    expect(rest.grabs).toEqual([])
    expect(codes(rest, 'p')).toEqual(['blocklisted'])
  })

  it('серии другого сезона той же раздачи не заблокированы', () => {
    const blocked = {
      ...noBlocks(),
      hashes: new Map([['p'.padEnd(40, '0'), new Set(['1:7', '1:8'])]]),
    }

    expect(
      grabbed(
        plan([found('p', PACK, { size: 12 * GB })], {
          blocked,
          wanted: keys(7, 8),
        }),
      ),
    ).toEqual([{ id: 'p', episodes: [7, 8] }])
  })

  it('раздача без infohash узнаётся по показу: страница, название и размер, без страницы — индексатор', () => {
    const page = 'https://tracker.example/topic/1'
    const byPage = episode(5, 'WEB-DL 1080p | LostFilm', {
      id: 'page',
      infoHash: undefined,
      seeders: 90,
      indexers: [{ id: 'ix', name: 'Indexer A', detailsUrl: page }],
    })
    // Тема обновилась на месте: адрес тот же, название другое
    const updated = found(
      'updated',
      'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 1-9 из 12 (2024) WEB-DL 1080p | LostFilm',
      {
        infoHash: undefined,
        seeders: 70,
        size: 14 * GB,
        indexers: [{ id: 'ix', name: 'Indexer A', detailsUrl: page }],
      },
    )
    const byTitle = found(
      'title',
      'Тихая гавань / Quiet Harbor / Сезон: 2 / Серия: 5 из 12 (2024) WEB-DL 1080p | LostFilm',
      { infoHash: undefined, seeders: 80 },
    )
    // Перезалив в той же теме с тем же названием: файлы исправили
    const reuploaded = found('reuploaded', byPage.title, {
      infoHash: undefined,
      seeders: 60,
      size: 1.6 * GB,
      indexers: [{ id: 'ix', name: 'Indexer A', detailsUrl: page }],
    })
    const otherIndexer = found('other', byTitle.title, {
      infoHash: undefined,
      seeders: 50,
      indexers: [{ id: 'iy', name: 'Indexer B' }],
    })
    const next = episode(5, 'WEB-DL 1080p | LostFilm', { id: 'next' })
    const result = plan(
      [byPage, byTitle, updated, reuploaded, otherIndexer, next],
      {
        blocked: {
          ...noBlocks(),
          listed: new Map([
            [
              listedKey({
                indexerId: 'ix',
                page,
                title: byPage.title,
                size: 1.5 * GB,
              }),
              null,
            ],
            [
              listedKey({
                indexerId: 'ix',
                title: byTitle.title,
                size: 1.5 * GB,
              }),
              null,
            ],
          ]),
        },
      },
    )

    expect(codes(result, 'page')).toEqual(['blocklisted'])
    expect(codes(result, 'title')).toEqual(['blocklisted'])
    expect(codes(result, 'updated')).not.toContain('blocklisted')
    expect(codes(result, 'reuploaded')).not.toContain('blocklisted')
    expect(codes(result, 'other')).not.toContain('blocklisted')
    expect(codes(result, 'next')).toEqual(['outranked'])
  })

  it('многосезонный пак: диапазон не делится по сезонам, решают файлы', () => {
    const multi = found(
      'multi',
      'Тихая гавань / Quiet Harbor / Сезон: 1-3 / Серии: 1-8 из 8 (2024) WEB-DL 1080p | LostFilm',
      { size: 60 * GB },
    )

    expect(grabbed(plan([multi], { wanted: keys(9) }))).toEqual([
      { id: 'multi', episodes: [9] },
    ])
  })
})
