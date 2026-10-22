import { execFile } from 'node:child_process'
import { config } from '../../config.ts'

export type MediaToolsState
  = { status: 'ok', version: string } | { status: 'missing' }

let detected: Promise<MediaToolsState> | undefined

function run(path: string) {
  return new Promise<string>((resolve, reject) => {
    execFile(path, ['-version'], { timeout: 10_000 }, (err, stdout) => {
      if (err)
        reject(err)
      else resolve(stdout)
    })
  })
}

/**
 * Есть ли ffmpeg и ffprobe. Проверяется один раз на процесс: без них
 * воспроизведение остаётся прямым, а причина пишется в журнал.
 */
export function mediaTools() {
  detected ??= Promise.all([run(config.ffmpegPath), run(config.ffprobePath)])
    .then(([ffmpeg]): MediaToolsState => ({
      status: 'ok',
      version: /version (\S+)/.exec(ffmpeg)?.[1] ?? 'unknown',
    }))
    .catch((): MediaToolsState => ({ status: 'missing' }))

  return detected
}

/** Тесты подменяют пути и проверяют заново */
export function resetMediaTools() {
  detected = undefined
}
