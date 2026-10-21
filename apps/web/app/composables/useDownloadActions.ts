import type { Torrent } from '@torsher/api-client'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { torrentErrorKind } from '~/composables/useTorrents'

const busyIds = ref(new Set<string>())

function setBusy(id: string, busy: boolean) {
  const next = new Set(busyIds.value)

  if (busy)
    next.add(id)
  else next.delete(id)

  busyIds.value = next
}

/** Действия строки и карточки загрузки с итоговыми тостами; ошибка — тостом с причиной */
export function useDownloadActions() {
  const { t } = useI18n()
  const torrents = useTorrents()

  async function run<T>(torrent: Torrent, action: () => Promise<T>) {
    setBusy(torrent.id, true)

    try {
      return await action()
    }
    catch (err) {
      const kind = await torrentErrorKind(err)

      toast.error(t(`panel.torrents.errorTitles.${kind}`), {
        description: t(`panel.torrents.errors.${kind}`),
      })
    }
    finally {
      setBusy(torrent.id, false)
    }
  }

  function togglePause(torrent: Torrent) {
    const pause = torrent.state !== 'paused'

    return run(torrent, async () => {
      await torrents.setPaused(torrent.id, pause)
      toast.success(
        t(
          pause
            ? 'panel.torrents.toasts.paused'
            : 'panel.torrents.toasts.resumed',
        ),
        {
          description: torrent.name,
        },
      )
    })
  }

  function toggleKeep(torrent: Torrent) {
    const keep = torrent.retention !== 'keep'

    return run(torrent, async () => {
      await torrents.setKept(torrent.id, keep)
      toast.success(
        t(keep ? 'panel.torrents.toasts.kept' : 'panel.torrents.toasts.unkept'),
        {
          description: t(
            keep
              ? 'panel.torrents.toasts.keptText'
              : 'panel.torrents.toasts.unkeptText',
          ),
        },
      )
    })
  }

  function download(torrent: Torrent, files: number[]) {
    return run(torrent, async () => {
      const updated = await torrents.downloadFiles(torrent.id, files)

      if (updated.pauseReason === 'storage') {
        toast.warning(t('panel.torrents.toasts.downloadStorage'), {
          description: torrent.name,
        })
      }
      else {
        toast.success(t('panel.torrents.toasts.download'), {
          description: t('panel.torrents.toasts.downloadText', files.length),
        })
      }
    })
  }

  function retry(torrent: Torrent) {
    return run(torrent, () => torrents.retryTorrent(torrent.id))
  }

  return {
    isBusy: (id: string) => busyIds.value.has(id),
    togglePause,
    toggleKeep,
    download,
    retry,
  }
}
