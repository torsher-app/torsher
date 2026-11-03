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
