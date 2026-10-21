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
