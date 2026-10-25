import type { EngineTorrentState } from '../engine/index.ts'
import { isStreaming } from '../storage/index.ts'
import { downloadStateOf, listTorrents } from '../torrents/index.ts'
import { notify } from './index.ts'

type Phase = 'active' | 'done' | 'other'

function phaseOf(
  state: EngineTorrentState | undefined,
  streaming: boolean,
): Phase {
  const download = downloadStateOf(state, streaming)

  if (
    download === 'queued'
    || download === 'downloading'
    || download === 'stalled'
  ) {
    return 'active'
  }

  // «Скачано» бывает только у выбранных файлов: окно стрима сюда не попадает
  return download === 'seeding' || download === 'complete' ? 'done' : 'other'
}

/**
 * «Загрузка завершена» — переход выбранных файлов из «качается» в «скачано».
 * Состояние — в памяти: после перезапуска уже скачанная раздача сразу видна
 * скачанной, и повторного сообщения нет.
 */
export function createDownloadWatcher() {
  const phases = new Map<string, Phase>()

  return {
    tick(live: Map<string, EngineTorrentState>) {
      const seen = new Set<string>()

      for (const torrent of listTorrents()) {
        const phase = phaseOf(
          live.get(torrent.infoHash),
          isStreaming(torrent.id),
        )
        const previous = phases.get(torrent.id)

        seen.add(torrent.id)
        phases.set(torrent.id, phase)

        // О закачках автоматики сообщает «Следить»: тайтл, серии, озвучка
        if (
          previous === 'active'
          && phase === 'done'
          && torrent.origin !== 'follow'
        ) {
          notify({
            kind: 'download_completed',
            severity: 'info',
            section: 'downloads',
            params: { name: torrent.name },
          })
        }
      }

      for (const id of phases.keys()) {
        if (!seen.has(id))
          phases.delete(id)
      }
    },
  }
}
