export type AssetMap = ReadonlyMap<string, string>
/** Names are used only in memory to match exact emitted assets; never sent. */
export async function loadSupportAssets(
  fetcher: typeof fetch,
  base: string,
  build: string,
): Promise<AssetMap> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const url = new URL('support-assets.json', base)
    if (!/^https?:$/.test(url.protocol))
      return new Map()
    const response = await fetcher(url.href, {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok || Number(response.headers.get('content-length')) > 32768)
      return new Map()
    // Do not allocate an unbounded response before validating the size.
    const reader = response.body?.getReader()
    if (!reader)
      return new Map()
    let text = ''
    let size = 0
    const decoder = new TextDecoder()
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done)
          break
        size += chunk.value.byteLength
        if (size > 32768) {
          await reader.cancel()
          return new Map()
        }
        text += decoder.decode(chunk.value, { stream: true })
      }
      text += decoder.decode()
    }
    finally {
      reader.releaseLock()
    }
    const value = JSON.parse(text)
    if (
      value.version !== 1
      || value.tvBuildId !== build
      || !value.assets
      || typeof value.assets !== 'object'
    ) {
      return new Map()
    }
    const entries = Object.entries(value.assets)
    if (entries.length > 128)
      return new Map()
    const assets = new Map<string, string>()
    for (const [path, hash] of entries) {
      if (
        !/^assets\/[\w.-]+\.js$/.test(path)
        || typeof hash !== 'string'
        || !/^[a-f0-9]{64}$/.test(hash)
      ) {
        return new Map()
      }
      assets.set(new URL(path, url).href, hash)
    }
    return assets
  }
  catch {
    return new Map()
  }
  finally {
    clearTimeout(timeout)
  }
}

export function safeLocations(stack: unknown, assets: AssetMap) {
  const locations: { assetId: string, line: number, column: number }[] = []
  let droppedLocations = 0
  if (typeof stack !== 'string')
    return { locations, droppedLocations }
  // Bound processing even when a malicious rejection supplies a huge stack string.
  for (const frame of stack.slice(0, 16384).split('\n').slice(0, 32)) {
    const match = frame.match(
      /(?:\(|\s|^)(https?:\/\/[^\s()]+):(\d+):(\d+)\)?$/,
    )
    if (!match) {
      if (/\bat\b|@/.test(frame))
        droppedLocations++
      continue
    }
    const assetId = assets.get(match[1]!)
    const line = Number(match[2])
    const column = Number(match[3])
    if (
      !assetId
      || locations.length >= 4
      || line < 1
      || line > 10_000_000
      || column > 10_000_000
    ) {
      droppedLocations++
      continue
    }
    locations.push({ assetId, line, column })
  }
  return { locations, droppedLocations }
}
