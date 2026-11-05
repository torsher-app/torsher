const MAX_BYTES = 26 * 1024 * 1024
// The report permits up to 1 MiB of metadata, including a large manifest.
const METADATA_LINE_BYTES = 1024 * 1024

export class SupportReportError extends Error {
  constructor(
    readonly code: 'unsupported' | 'incomplete' | 'invalid' | 'too_large',
  ) {
    super(`Support report ${code}`)
  }
}
function record(line: string) {
  try {
    const parsed: unknown = JSON.parse(line)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed as Record<string, unknown>
  }
  catch {}
  throw new SupportReportError('invalid')
}

/** Do not save an old server's plain log, a truncated stream, or a huge response. */
export async function readSupportReport(response: Response) {
  if (response.headers.get('X-Torsher-Report-Version') !== '1') {
    await response.body?.cancel()
    throw new SupportReportError('unsupported')
  }
  const reader = response.body?.getReader()
  if (!reader)
    throw new SupportReportError('incomplete')
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break
      bytes += value.byteLength
      if (bytes > MAX_BYTES)
        throw new SupportReportError('too_large')
      chunks.push(new Uint8Array(value))
    }
  }
  catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  }
  finally {
    reader.releaseLock()
  }
  const blob = new Blob(chunks, { type: 'text/plain;charset=utf-8' })
  const head = await blob.slice(0, METADATA_LINE_BYTES).text()
  const tail = await blob
    .slice(Math.max(0, blob.size - METADATA_LINE_BYTES))
    .text()
  if (!head.includes('\n') || !tail.endsWith('\n'))
    throw new SupportReportError('incomplete')
  const manifest = record(head.slice(0, head.indexOf('\n')))
  const last = tail.slice(0, -1)
  const footer = record(last.slice(last.lastIndexOf('\n') + 1))
  if (footer.type !== 'footer' || footer.exportComplete !== true)
    throw new SupportReportError('incomplete')
  if (
    manifest.type !== 'manifest'
    || manifest.reportSchemaVersion !== 1
    || footer.reportSchemaVersion !== 1
    || typeof manifest.reportId !== 'string'
    || !/^[a-f0-9-]{36}$/i.test(manifest.reportId)
    || footer.reportId !== manifest.reportId
    || !['unknown', 'partial'].includes(String(footer.coverage))
  ) {
    throw new SupportReportError('invalid')
  }
  return { blob, partial: footer.coverage === 'partial' }
}
