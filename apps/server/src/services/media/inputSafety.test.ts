import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { thumbArgs } from '../library/thumbs.ts'
import { inputArgs } from './hls.ts'
import { untrustedInputArgs } from './inputSafety.ts'
import { probeArgs, probeMedia } from './probe.ts'

const execFileAsync = promisify(execFile)

function flagsBefore(args: string[], input: string) {
  const at = args.lastIndexOf(input)
  const protocolsAt = args.indexOf('-protocol_whitelist')
  const formatsAt = args.indexOf('-format_whitelist')

  return {
    protocols: args[protocolsAt + 1],
    beforeInput:
      args.includes('-protocol_whitelist')
      && args.includes('-format_whitelist')
      && protocolsAt < at
      && formatsAt < at,
  }
}

describe('untrustedInputArgs', () => {
  it('engine stream reads only over HTTP, library file only from disk', () => {
    expect(untrustedInputArgs('http://127.0.0.1:9/stream')).toContain(
      'http,tcp',
    )
    expect(untrustedInputArgs('/data/library/a.mkv')).toContain('file')
    expect(untrustedInputArgs('https://indexer.example/a.mkv')).toContain(
      'file',
    )
  })

  it('probe, HLS and thumbnail inputs get both lists before the input', () => {
    const url = 'http://127.0.0.1:9/torrents/x/files/0/stream'
    const path = '/data/library/movies/a.mkv'

    expect(flagsBefore(probeArgs(url), url)).toEqual({
      protocols: 'http,tcp',
      beforeInput: true,
    })
    expect(flagsBefore(probeArgs(path), path)).toEqual({
      protocols: 'file',
      beforeInput: true,
    })
    expect(flagsBefore(inputArgs(url), url)).toEqual({
      protocols: 'http,tcp',
      beforeInput: true,
    })
    expect(flagsBefore(thumbArgs(path, '/tmp/t.jpg', 60), path)).toEqual({
      protocols: 'file',
      beforeInput: true,
    })
  })
})

function hasFfmpeg() {
  // В `.env.test` ffmpeg нет нарочно: здесь нужен настоящий
  vi.stubEnv('FFMPEG_PATH', 'ffmpeg')
  vi.stubEnv('FFPROBE_PATH', 'ffprobe')

  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
}

describe.runIf(hasFfmpeg())('ffprobe on a hostile stream', () => {
  let server: Server
  let base: string
  let dir: string
  let segments = 0

  beforeAll(async () => {
    vi.stubEnv('FFMPEG_PATH', 'ffmpeg')
    vi.stubEnv('FFPROBE_PATH', 'ffprobe')
    dir = mkdtempSync(join(tmpdir(), 'torsher-input-safety-'))

    server = createServer((req, res) => {
      if (req.url?.startsWith('/seg')) {
        segments++
        res.end('x')
        return
      }

      // Манифест DASH под видом файла раздачи: ffprobe узнаёт его по содержимому
      res.setHeader('content-type', 'application/octet-stream')
      res.end(`<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT1S" minBufferTime="PT1S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011">
<Period><AdaptationSet mimeType="video/mp4"><Representation id="1" bandwidth="1000" codecs="avc1.4d401e" width="64" height="64">
<BaseURL>${base}/seg.mp4</BaseURL>
</Representation></AdaptationSet></Period></MPD>
`)
    })
    await new Promise<void>(resolve =>
      server.listen(0, '127.0.0.1', resolve),
    )
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('without the lists ffprobe follows the manifest; with them it does not', async () => {
    const url = `${base}/v.mkv`

    segments = 0
    await execFileAsync('ffprobe', ['-v', 'error', url]).catch(() => {})
    expect(segments).toBeGreaterThan(0)

    segments = 0
    await expect(probeMedia(`hostile:${url}`, url, 'v.mkv')).rejects.toThrow(
      /not on whitelist/,
    )
    expect(segments).toBe(0)
  })

  it.each(['mkv', 'mp4'])('a real %s file still probes', async (extension) => {
    const path = join(dir, `sample.${extension}`)

    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=d=1:s=64x64',
      '-y',
      path,
    ])

    const media = await probeMedia(
      `sample:${path}`,
      path,
      `sample.${extension}`,
    )

    expect(media.video).not.toBeNull()
  })
})
