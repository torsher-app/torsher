import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../../config.ts'
import { fingerprint } from './process.ts'

let root: string
async function executable(name: string, code: string) {
  const path = join(root, name)
  await writeFile(path, `#!${process.execPath}\n${code}`, { mode: 0o700 })
  return path
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'torsher-analysis-process-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})
describe('analysis child ownership', () => {
  it.runIf(spawnSync('ffmpeg', ['-version']).status === 0)(
    'aligns fingerprint PCM to playback time and bounds it to the analysis window',
    async () => {
      // A PCM reader in place of fpcalc measures when the non-silent audio starts.
      const calculator = await executable(
        'calculator',
        `
const chunks = [];
process.stdin.on('data', chunk => chunks.push(chunk));
process.stdin.on('end', () => {
  const pcm = Buffer.concat(chunks);
  let onset = 0;
  while (onset * 2 < pcm.length && Math.abs(pcm.readInt16LE(onset * 2)) <= 10) onset++;
  console.log(JSON.stringify({ fingerprint: [onset, pcm.length / 2] }));
});
`,
      )
      vi.spyOn(config, 'ffmpegPath', 'get').mockReturnValue('ffmpeg')
      vi.spyOn(config, 'fpcalcPath', 'get').mockReturnValue(calculator)
      for (const delay of [0, 3]) {
        const path = join(root, `offset-${delay}.mkv`)
        execFileSync('ffmpeg', [
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=s=32x32:r=1:d=10',
          '-itsoffset',
          String(delay),
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:sample_rate=11025:duration=9',
          '-map',
          '0:v',
          '-map',
          '1:a',
          '-c:v',
          'ffv1',
          '-c:a',
          'pcm_s16le',
          '-output_ts_offset',
          '7',
          path,
        ])
        const [onset, samples] = await fingerprint(
          path,
          1,
          5,
          new AbortController().signal,
        )
        expect(onset / 11025).toBeCloseTo(delay, 2)
        expect(samples).toBe(5 * 11025)
      }
    },
  )

  it('pipes decoded bytes, accepts zero stdin duration and validates raw points', async () => {
    const decoder = await executable('decoder', 'process.stdout.write("pcm");')
    const calculator = await executable(
      'calculator',
      'let data="";process.stdin.on("data",b=>data+=b);process.stdin.on("end",()=>{if(data!=="pcm")process.exit(2);console.log(JSON.stringify({duration:0,fingerprint:[1,2,4294967295]}))});',
    )
    vi.spyOn(config, 'ffmpegPath', 'get').mockReturnValue(decoder)
    vi.spyOn(config, 'fpcalcPath', 'get').mockReturnValue(calculator)
    expect(
      await fingerprint(
        '/synthetic/video.mp4',
        1,
        120,
        new AbortController().signal,
      ),
    ).toEqual([1, 2, 4294967295])
    await writeFile(
      calculator,
      `#!${process.execPath}\nconsole.log('{"fingerprint":[1.5]}')`,
    )
    await expect(
      fingerprint('/synthetic/video.mp4', 1, 120, new AbortController().signal),
    ).rejects.toThrow('Invalid fingerprint')
  })
  it('reaps both children when playback aborts the pipeline', async () => {
    const decoder = await executable(
      'decoder',
      `require('node:fs').writeFileSync(${JSON.stringify(join(root, 'decoder.pid'))},String(process.pid));setInterval(()=>process.stdout.write('pcm'),10)`,
    )
    const calculator = await executable(
      'calculator',
      `require('node:fs').writeFileSync(${JSON.stringify(join(root, 'calculator.pid'))},String(process.pid));process.stdin.resume();setInterval(()=>{},1000)`,
    )
    vi.spyOn(config, 'ffmpegPath', 'get').mockReturnValue(decoder)
    vi.spyOn(config, 'fpcalcPath', 'get').mockReturnValue(calculator)
    const controller = new AbortController()
    const result = fingerprint(
      '/synthetic/video.mp4',
      1,
      120,
      controller.signal,
    )
    const rejected = expect(result).rejects.toThrow()
    await vi.waitFor(async () =>
      expect(await readFile(join(root, 'calculator.pid'), 'utf8')).toMatch(
        /^\d+$/,
      ),
    )
    const pids = await Promise.all(
      ['decoder', 'calculator'].map(async name =>
        Number(await readFile(join(root, `${name}.pid`), 'utf8')),
      ),
    )
    controller.abort()
    await rejected
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
  })
  it('fails boundedly when fpcalc is missing and closes the decoder', async () => {
    const decoder = await executable(
      'decoder',
      'setInterval(()=>process.stdout.write("pcm"),10)',
    )
    vi.spyOn(config, 'ffmpegPath', 'get').mockReturnValue(decoder)
    vi.spyOn(config, 'fpcalcPath', 'get').mockReturnValue(
      join(root, 'missing'),
    )
    await expect(
      fingerprint('/synthetic/video.mp4', 1, 120, new AbortController().signal),
    ).rejects.toThrow()
  })
})
