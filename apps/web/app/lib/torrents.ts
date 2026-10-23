import type { Torrent } from '@torsher/api-client'
/** Содержимое файла в base64 без префикса data URL */
export function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const result = String(reader.result)

      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** Маршрут плеера витрины: витрина на hash-истории */
export function playerUrl(tvUrl: string, torrentId: string, fileIndex: number) {
  const base = tvUrl.endsWith('/') ? tvUrl : `${tvUrl}/`

  return `${base}#/play/${encodeURIComponent(torrentId)}/${fileIndex}`
}

// Совпадает с лимитом сервера на `.torrent`
export const TORRENT_FILE_MAX_BYTES = 8 * 1024 * 1024

/** Видео раздачи, которые «Скачать» отмечает по умолчанию */
export function videoIndexes(torrent: Pick<Torrent, 'files'>) {
  return torrent.files.filter(file => file.isVideo).map(file => file.index)
}

/**
 * Одно видео (фильм) — после добавления качаем сразу: выбирать нечего.
 * Сериал и пак — карточка с отмеченными видео, выбор за владельцем.
 */
export function isSingleVideo(torrent: Pick<Torrent, 'files' | 'status'>) {
  return torrent.status === 'ready' && videoIndexes(torrent).length === 1
}
