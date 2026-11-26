import { currentAddon } from '../addons/index.ts'
import { playableMediaFile } from '../library/folders.ts'
import type { PlaybackSession } from '../media/index.ts'
import { getTorrent } from '../torrents/index.ts'
import { titleAllowedCached } from './access.ts'

const profileOfSession = new WeakMap<PlaybackSession, string>()
export function bindSessionProfile(
  session: PlaybackSession,
  profileId: string,
) {
  profileOfSession.set(session, profileId)
}
export function sessionAccessible(session: PlaybackSession, profileId: string) {
  if (profileOfSession.get(session) !== profileId)
    return false
  if (session.addonMedia) {
    const { addon, target } = session.addonMedia.launch
    return (
      !!currentAddon(addon.id, addon.revision, 'stream')
      && titleAllowedCached(profileId, target.titleId)
    )
  }
  if (session.library)
    return !!playableMediaFile(session.library.id, profileId)
  const torrent = session.torrent && getTorrent(session.torrent.id)
  return !!torrent && titleAllowedCached(profileId, torrent.titleId)
}
