import type { VideoClass, VoiceType } from '@torsher/release-parser'

/** Как ранжировать раздачи. Профиль пока один на сервер; настройка — позже. */
export interface RankingProfile {
  /** Лестница качества с откатом: первое — лучшее. */
  qualities: VideoClass[]
  /** Типы русской озвучки по убыванию предпочтения. */
  voiceTypes: VoiceType[]
}

export const DEFAULT_PROFILE: RankingProfile = {
  qualities: ['1080p', '2160p', '720p'],
  voiceTypes: ['D', 'MVO', 'DVO', 'AVO', 'VO', 'L'],
}

/** Озвучка, закреплённая за сезоном: студия, а без неё — тип перевода */
export interface VoiceRef {
  studio?: string
  type?: VoiceType
}
