import { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { setImmediate } from 'node:timers/promises'
import { config } from '../../config.ts'
import { untrustedInputArgs } from '../media/inputSafety.ts'
import { classify, textRuns } from './credits.ts'
import { creditsWindow, FRAME_SIZE } from './model.ts'

function completion(child: ChildProcess) {
  return new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0)
        resolve()
      else reject(new Error(`Analysis process exited with ${code}`))
    })
  })
}

/**
 Each task owns its processes
cancellation and failures reap both children.
 */
async function run<T>(
  signal: AbortSignal,
  action: (
    launch: (path: string, args: string[]) => ReturnType<typeof spawn>,
  ) => Promise<T>,
) {
  signal.throwIfAborted()
  const children: ChildProcess[] = []
  const done: Promise<void>[] = []
  const abort = () => children.forEach(child => child.kill('SIGKILL'))
  signal.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, 180_000)
  try {
    const value = await action((path, args) => {
      const child = spawn(path, args, { stdio: ['pipe', 'pipe', 'pipe'] })
      children.push(child)
      // Drain stderr without accumulating paths, media data, or unbounded output.
      child.stderr?.resume()
      child.stdin?.on('error', () => {})
      const finished = completion(child)
      void finished.catch(abort)
      done.push(finished)
      if (signal.aborted)
        abort()
      return child
    })
    await Promise.all(done)
    signal.throwIfAborted()
    return value
  }
  finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
    abort()
    await Promise.allSettled(done)
  }
}

export async function fingerprint(
  path: string,
  track: number,
  window: number,
  signal: AbortSignal,
) {
  return run(signal, async (launch) => {
    const decoder = launch(config.ffmpegPath, [
      '-nostdin',
      '-v',
      'error',
      '-threads',
      '1',
      '-filter_threads',
      '1',
      ...untrustedInputArgs(path),
      '-i',
      path,
      '-t',
      String(window),
      '-map',
      `0:${track}`,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '11025',
      '-f',
      's16le',
      'pipe:1',
    ])
    const calculator = launch(config.fpcalcPath, [
      '-format',
      's16le',
      '-rate',
      '11025',
      '-channels',
      '1',
      '-length',
      String(window),
      '-raw',
      '-json',
      '-',
    ])
    decoder.stdout!.pipe(calculator.stdin!)
    let output = ''
    for await (const chunk of calculator.stdout!) {
      output += chunk.toString()
      if (output.length > 150_000)
        throw new Error('Fingerprint output exceeds limit')
    }
    const parsed: unknown = JSON.parse(output)
    const points = (parsed as { fingerprint?: unknown }).fingerprint
    if (
      !Array.isArray(points)
      || points.length > 5000
      || !points.every(
        point =>
          Number.isInteger(point)
          && point >= -2147483648
          && point <= 4294967295,
      )
    ) {
      throw new Error('Invalid fingerprint')
    }
    return points as number[]
  })
}

async function sample(
  path: string,
  start: number,
  duration: number,
  fps: number,
  signal: AbortSignal,
) {
  return run(signal, async (launch) => {
    const decoder = launch(config.ffmpegPath, [
      '-nostdin',
      '-v',
      'error',
      '-threads',
      '1',
      '-filter_threads',
      '1',
      '-ss',
      String(start),
      ...untrustedInputArgs(path),
      '-i',
      path,
      '-t',
      String(duration),
      '-an',
      '-vf',
      `fps=${fps},scale=320:180,format=gray`,
      '-f',
      'rawvideo',
      'pipe:1',
    ])
    const frames: boolean[] = []
    let pending = Buffer.alloc(0)
    for await (const chunk of decoder.stdout!) {
      pending = Buffer.concat([pending, chunk])
      while (pending.length >= FRAME_SIZE) {
        signal.throwIfAborted()
        if (frames.length > Math.ceil(duration * fps) + 2)
          throw new Error('Frame output exceeds limit')
        frames.push(classify(pending.subarray(0, FRAME_SIZE)).text)
        pending = pending.subarray(FRAME_SIZE)
        await setImmediate()
      }
    }
    if (pending.length)
      throw new Error('Incomplete analysis frame')
    return frames
  })
}

export async function credits(
  path: string,
  duration: number,
  signal: AbortSignal,
) {
  const offset = duration - creditsWindow(duration)
  const coarse = await sample(path, offset, duration - offset, 1, signal)
  const confirmed: { start: number, end: number }[] = []
  for (const run of textRuns(coarse, 1)) {
    signal.throwIfAborted()
    const start = Math.max(0, run.start - 1)
    const end = Math.min(duration - offset, run.end + 1)
    const dense = await sample(path, offset + start, end - start, 8, signal)
    for (const core of textRuns(dense, 8, 17)) {
      confirmed.push({
        start: offset + start + core.start + 1,
        end: offset + start + core.end - 1,
      })
    }
  }
  return confirmed
}
