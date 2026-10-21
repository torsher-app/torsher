export type ReleaseKind = 'movie' | 'series' | 'unknown'

/** `issue` — выпуски шоу вместо серий («1 выпуск из 12»). */
export type EpisodeUnit = 'episode' | 'issue'

export interface EpisodeRange {
  from: number
  to: number
  /** Сколько серий в сезоне по словам раздачи; нет — если не указано или «из ??». */
  total?: number
  unit: EpisodeUnit
}

export interface AbsoluteRange {
  from: number
  to: number
}

export type Resolution
  = '2160p' | '1440p' | '1080p' | '1080i' | '720p' | '576p' | '480p' | '360p'

export type Source
  = | 'WEB-DL'
    | 'WEB-DLRip'
    | 'WEBRip'
    | 'BDRemux'
    | 'BDRip'
    | 'Blu-ray'
    | 'HDRip'
    | 'HDTV'
    | 'HDTVRip'
    | 'SATRip'
    | 'IPTV'
    | 'TVRip'
    | 'DVB'
    | 'DVDRip'
    | 'DVD'
    | 'TS'
    | 'CAMRip'

export type Codec
  = 'H.264' | 'H.265' | 'AV1' | 'VP9' | 'XviD' | 'DivX' | 'MPEG-2' | 'VC-1'

export type Hdr = 'HDR10' | 'HDR10+' | 'DV' | 'HLG'

/**
 * Тип перевода. `D` — дубляж, `MVO`/`DVO`/`VO` — профессиональный закадровый
 * многоголосый/двухголосый/одноголосый, `AVO` — авторский, `L` — любительский,
 * `Original` — оригинальная дорожка.
 */
export type VoiceType = 'D' | 'MVO' | 'DVO' | 'VO' | 'AVO' | 'L' | 'Original'

export interface AudioTrack {
  /** Нет, когда в названии указан только язык («Rus», «Ukr»). */
  type?: VoiceType
  /** Каноническое имя из словаря студий. */
  studio?: string
  /** ISO 639-1, только если язык указан явно. */
  language?: string
}

export interface ReleaseTitles {
  ru?: string
  orig?: string
  translit?: string
  /** Прочие названия из раздачи: третье название через ` / `, альтернативное в скобках. */
  alt?: string[]
}

export type ParsedField
  = | 'titles'
    | 'year'
    | 'kind'
    | 'seasons'
    | 'episodes'
    | 'absolute'
    | 'quality'
    | 'source'
    | 'codec'
    | 'audio'

export interface ParsedRelease {
  raw: string
  titles: ReleaseTitles
  year?: number
  kind: ReleaseKind
  seasons: number[]
  episodes?: EpisodeRange
  /** Абсолютная нумерация без сезона, как у аниме: `Title - 1071`. */
  absolute?: AbsoluteRange
  quality?: Resolution
  source?: Source
  codec?: Codec
  hdr: Hdr[]
  audio: AudioTrack[]
  /** Языки субтитров (ISO 639-1); `und` — субтитры есть, язык не указан. */
  subs: string[]
  /** Релиз-группа scene-имени или фансаб-группа в начале названия. */
  group?: string
  isPack: boolean
  isOngoing: boolean
  /** Уверенность 0..1 по каждому найденному полю. */
  confidence: Partial<Record<ParsedField, number>>
  /** Фрагменты исходного названия, которые парсер не понял. */
  unparsed: string[]
}

export interface ReleaseFile {
  path: string
  size: number
}

export type FileKind
  = 'video' | 'sample' | 'extra' | 'subtitle' | 'audio' | 'image' | 'other'

export interface FileMatch {
  path: string
  size: number
  kind: FileKind
  season?: number
  episode?: number
  /** Последняя серия, если файл содержит несколько (`S01E01E02`). */
  episodeTo?: number
  absolute?: number
  /** 0..1; нет у служебных файлов и у видео без номера. */
  confidence?: number
}
