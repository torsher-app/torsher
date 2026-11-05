import { describe, expect, it } from 'vitest'
import { readSupportReport } from './supportReport'

const reportId = '00000000-0000-4000-8000-000000000001'
const manifest = { type: 'manifest', reportId, reportSchemaVersion: 1 }
const footer = {
  type: 'footer',
  reportId,
  reportSchemaVersion: 1,
  exportComplete: true,
  coverage: 'unknown',
}
function response(rows: object[], header = '1') {
  return new Response(
    `${rows.map(row => JSON.stringify(row)).join('\n')}\n`,
    { headers: { 'X-Torsher-Report-Version': header } },
  )
}
describe('support report download validation', () => {
  it('rejects a legacy server that ignores the format query', async () => {
    await expect(
      readSupportReport(new Response('Torsher log')),
    ).rejects.toMatchObject({ code: 'unsupported' })
    await expect(
      readSupportReport(response([manifest, footer], '2')),
    ).rejects.toMatchObject({ code: 'unsupported' })
  })
  it('rejects missing, mismatched and incomplete footers', async () => {
    await expect(readSupportReport(response([manifest]))).rejects.toMatchObject(
      { code: 'incomplete' },
    )
    await expect(
      readSupportReport(
        response([manifest, { ...footer, exportComplete: false }]),
      ),
    ).rejects.toMatchObject({ code: 'incomplete' })
    await expect(
      readSupportReport(response([manifest, { ...footer, reportId: 'other' }])),
    ).rejects.toMatchObject({ code: 'invalid' })
  })
  it('returns a valid file and distinguishes partial coverage', async () => {
    const complete = await readSupportReport(response([manifest, footer]))
    expect(complete.partial).toBe(false)
    expect(await complete.blob.text()).toContain(reportId)
    expect(
      (
        await readSupportReport(
          response([manifest, { ...footer, coverage: 'partial' }]),
        )
      ).partial,
    ).toBe(true)
  })
  it('accepts a bounded manifest containing many pending failure summaries', async () => {
    const largeManifest = {
      ...manifest,
      environment: {
        pendingFailureSuppression: {
          records: Array.from({ length: 128 }, (_, index) => ({
            observedAt: '2026-11-05T00:00:00.000Z',
            origin: 'server',
            event: 'server.failure_summary',
            facts: {
              actorKind: 'device',
              deviceId: `device-${String(index).padStart(73, '0')}`,
              profileId: 'p'.repeat(80),
              clientSessionId: 'c'.repeat(80),
              session: 's'.repeat(80),
              serverInstance: reportId,
              code: 'request_failed',
              suppressionReason: 'repeated',
              suppressed: 2,
              windowStartedAt: '2026-11-05T00:00:00.000Z',
              windowEndedAt: '2026-11-05T00:01:00.000Z',
            },
          })),
        },
      },
    }
    const bytes = new TextEncoder().encode(
      JSON.stringify(largeManifest),
    ).length
    expect(bytes).toBeGreaterThan(64 * 1024)
    expect(bytes).toBeLessThan(1024 * 1024)
    const result = await readSupportReport(response([largeManifest, footer]))
    expect(result.blob.size).toBeGreaterThan(bytes)
  })
  it('rejects stream interruption and cancels oversized downloads', async () => {
    const broken = new ReadableStream({
      start(controller) {
        controller.error(new Error('network failure'))
      },
    })
    await expect(
      readSupportReport(
        new Response(broken, { headers: { 'X-Torsher-Report-Version': '1' } }),
      ),
    ).rejects.toThrow('network failure')
    let cancelled = false
    const oversized = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024))
      },
      cancel() {
        cancelled = true
      },
    })
    await expect(
      readSupportReport(
        new Response(oversized, {
          headers: { 'X-Torsher-Report-Version': '1' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'too_large' })
    expect(cancelled).toBe(true)
  })
})
