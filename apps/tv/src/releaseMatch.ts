import { getErrorStatus } from '@torsher/api-client'
import { reactive, readonly } from 'vue'
import { api } from './api.ts'

export type ReleaseOutcome = 'saved' | 'ignored' | 'restricted' | 'failed'

const state = reactive({
  // Растёт с каждым выбором: «Библиотека» перечитывает ряды
  version: 0,
  // Итог выбора из поиска: тост показывает «Библиотека», куда вернулись
  notice: '' as '' | ReleaseOutcome,
})

/** Тайтл нераспознанной раздачи, выбранный на витрине */
export const releaseMatch = readonly(state)

/** `null` — «не фильм и не сериал»: раздача уходит из ряда, файлы — в загрузках */
export async function setReleaseTitle(
  torrentId: string,
  titleId: string | null,
): Promise<ReleaseOutcome> {
  try {
    await api.torrents.putTorrentTitle(torrentId, { titleId })
    state.version++

    return titleId ? 'saved' : 'ignored'
  }
  catch (err) {
    return getErrorStatus(err) === 403 ? 'restricted' : 'failed'
  }
}

export function noteReleaseOutcome(outcome: '' | ReleaseOutcome) {
  state.notice = outcome
}
