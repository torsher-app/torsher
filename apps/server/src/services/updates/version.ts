/** Версия по semver 2.0: числа и метки пререлиза; метаданные сборки отброшены */
export interface Version {
  major: number
  minor: number
  patch: number
  prerelease: (number | string)[]
}

const VERSION_RE
  = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/

/** `v1.2.3-beta.1` и `1.2.3` — версии; всё остальное (`0.3`, `latest`) — нет */
export function parseVersion(input: string): Version | undefined {
  const match = VERSION_RE.exec(input.trim())

  if (!match)
    return undefined

  const [, major, minor, patch, pre] = match

  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: pre
      ? pre.split('.').map(part => (/^\d+$/.test(part) ? Number(part) : part))
      : [],
  }
}

function compareIdentifiers(a: number | string, b: number | string) {
  if (typeof a === 'number' && typeof b === 'number')
    return a - b

  // Числовая метка всегда младше буквенной
  if (typeof a === 'number')
    return -1

  if (typeof b === 'number')
    return 1

  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Старшинство по semver: `1.0.0-beta.2 < 1.0.0-beta.10 < 1.0.0-rc.1 < 1.0.0`.
 * Пререлиз младше своего релиза — иначе сервер на `1.0.0` счёл бы
 * `1.0.0-rc.1` новой версией.
 */
export function compareVersions(a: Version, b: Version) {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch

  if (core)
    return Math.sign(core)

  if (!a.prerelease.length || !b.prerelease.length)
    return Math.sign(b.prerelease.length - a.prerelease.length)

  const length = Math.max(a.prerelease.length, b.prerelease.length)

  for (let i = 0; i < length; i++) {
    const left = a.prerelease[i]
    const right = b.prerelease[i]

    // Короче при равном начале — младше: `1.0.0-beta < 1.0.0-beta.1`
    if (left === undefined)
      return -1

    if (right === undefined)
      return 1

    const order = compareIdentifiers(left, right)

    if (order)
      return Math.sign(order)
  }

  return 0
}

export function isNewerVersion(candidate: string, current: string) {
  const next = parseVersion(candidate)
  const now = parseVersion(current)

  return Boolean(next && now && compareVersions(next, now) > 0)
}
