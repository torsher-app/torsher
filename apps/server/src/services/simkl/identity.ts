import { createHash } from 'node:crypto'

const movieKey = /^([1-9]\d*):movie$/
const episodeKey = /^([1-9]\d*):tv:(?:0|[1-9]\d*):[1-9]\d*$/
const originKey = /^[a-f0-9]{64}\/(.+)$/

export function simklAccountFingerprint(accountId: number) {
  return createHash('sha256').update(`simkl:${accountId}`).digest('hex')
}

export function simklRemoteKey(id: number, season: number, episode: number) {
  return episode ? `${id}:tv:${season}:${episode}` : `${id}:movie`
}

export function simklOriginKey(accountFingerprint: string, remoteKey: string) {
  return `${accountFingerprint}/${remoteKey}`
}

export function simklSourceUrl(key: string | null) {
  const remote = key && originKey.exec(key)?.[1]
  if (!remote)
    return undefined
  const movie = movieKey.exec(remote)
  if (movie)
    return `https://simkl.com/movies/${movie[1]}`
  const episode = episodeKey.exec(remote)
  if (episode)
    return `https://simkl.com/tv/${episode[1]}`
  return undefined
}
