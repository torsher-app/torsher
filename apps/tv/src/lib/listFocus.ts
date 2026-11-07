/** Preserve identity; if removed, prefer the next surviving old neighbour. */
export function survivingFocus(
  previous: string[],
  next: string[],
  selected: string,
) {
  const available = new Set(next)
  if (available.has(selected))
    return selected
  const index = previous.indexOf(selected)
  if (index < 0)
    return next[0]
  for (let distance = 1; distance < previous.length; distance++) {
    const after = previous[index + distance]
    if (after !== undefined && available.has(after))
      return after
    const before = previous[index - distance]
    if (before !== undefined && available.has(before))
      return before
  }
  return next[Math.max(0, Math.min(index, next.length - 1))]
}
