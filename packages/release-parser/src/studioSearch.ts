import type { Studio } from './studios.ts'
import { studioKey } from './studios.ts'

export { studioKey, studios } from './studios.ts'
export type { Studio } from './studios.ts'

export type StudioMatch = 'exact' | 'prefix' | 'substring' | 'fuzzy' | 'browse'
export interface StudioSearchResult {
  studio: Studio
  match: StudioMatch
}

/** One insertion, deletion or substitution, across the entire normalized name. */
function oneEdit(a: string, b: string): boolean {
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1)
    return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1)
      return false
    if (a.length >= b.length)
      i++
    if (b.length >= a.length)
      j++
  }
  return edits + Number(i < a.length || j < b.length) <= 1
}

/** UI suggestions only. Never used to recognize a release or validate a policy. */
export function searchStudios(
  query: string,
  collection: readonly Studio[],
): StudioSearchResult[] {
  const key = studioKey(query)
  const ranks: Record<StudioMatch, number> = {
    exact: 0,
    prefix: 1,
    substring: 2,
    fuzzy: 3,
    browse: 4,
  }
  const matches = new Map<string, StudioSearchResult>()
  for (const studio of collection) {
    let match: StudioMatch | undefined = key ? undefined : 'browse'
    for (const name of [studio.name, ...(studio.aliases ?? [])]) {
      const candidate = studioKey(name)
      const next = !key
        ? 'browse'
        : candidate === key
          ? 'exact'
          : candidate.startsWith(key)
            ? 'prefix'
            : candidate.includes(key)
              ? 'substring'
              : oneEdit(key, candidate)
                ? 'fuzzy'
                : undefined
      if (next && (!match || ranks[next] < ranks[match]))
        match = next
    }
    if (!match)
      continue
    const canonical = studioKey(studio.name)
    const previous = matches.get(canonical)
    if (!previous)
      matches.set(canonical, { studio, match })
    else if (ranks[match] < ranks[previous.match])
      previous.match = match
  }
  let fuzzy = 0
  return [...matches.values()]
    .sort(
      (a, b) =>
        ranks[a.match] - ranks[b.match]
        || (studioKey(a.studio.name) < studioKey(b.studio.name)
          ? -1
          : studioKey(a.studio.name) > studioKey(b.studio.name)
            ? 1
            : 0),
    )
    .filter(item => item.match !== 'fuzzy' || ++fuzzy <= 5)
}
