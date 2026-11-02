import { getSetting, setSetting } from '../settings/index.ts'

export function automaticThumbnails() {
  return getSetting<boolean>('library.thumbnails') ?? true
}

export function setAutomaticThumbnails(enabled: boolean) {
  setSetting('library.thumbnails', enabled)
}
