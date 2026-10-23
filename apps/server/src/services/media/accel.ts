import type { EncoderCaps, ToneMapping, VideoEncoder } from './encode.ts'
import type { Buffer } from 'node:buffer'
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { setPriority, tmpdir } from 'node:os'
import { join } from 'node:path'
import { config } from '../../config.ts'
import { gpuToneMap, softwareToneMap } from './encode.ts'
import { logFor } from '../logs/index.ts'
import { getSetting, setSetting } from '../settings/index.ts'

/** Чем перекодировать: что найдено (`auto`) или только процессором */
export type AccelMode = 'auto' | 'software'

export interface GpuEncoder {
  encoder: Exclude<VideoEncoder, 'software'>
  /** VAAPI: `/dev/dri/renderD*`; NVENC — первая карта */
  device: string | null
  /** Драйвер VAAPI или модель NVIDIA */
  name: string | null
  lowPower: boolean
  /** Что декодирует сама: ключи `decodeKeyOf` */
  decode: string[]
}

export interface AccelState {
  mode: AccelMode
  /** Чем кодируется сейчас; null — кодировщика H.264 нет совсем */
  encoder: VideoEncoder | null
  gpus: GpuEncoder[]
  /** Есть `libx264` */
  software: boolean
  /** Кадров в секунду `libx264 veryfast` на 1080p; null — не замерено */
  softwareFps: number | null
  /** Потолок высоты кадра для процессора, по замеру */
  softwareMaxHeight: number
  /** HDR → SDR на видеокарте (`libplacebo` на Vulkan) */
  gpuToneMapping: boolean
  /** HDR → SDR процессором (`zscale` и `tonemap`) */
  softwareToneMapping: boolean
  /** Кадров в секунду перевода HDR → SDR тем способом, что выбран, на 1080p */
  toneMappingFps: number | null
  /** Потолок высоты кадра для HDR, по замеру перевода */
  toneMappingMaxHeight: number
  checkedAt: string
}

export interface RunResult {
  code: number | null
  stderr: string
  ms: number
}

const MODE_KEY = 'mediaAccel'
const RUN_TIMEOUT_MS = 30_000
// Перекодирование должно успевать с запасом: вдвое быстрее 25 к/с
const REALTIME_FPS = 25
const HEADROOM = 2
const BENCH_FRAMES = 50
// 720p — 0.44 пикселей 1080p: настолько же быстрее при той же скорости x264
const PIXELS_720_OF_1080 = (1280 * 720) / (1920 * 1080)
const GPU_MAX_HEIGHT = 1080
const SD_HEIGHT = 576

/** Запуск ffmpeg и чтение каталога устройств: тесты подменяют через `vi.spyOn` */
export const accelDeps = {
  run(args: string[]): Promise<RunResult> {
    return new Promise((resolve) => {
      const started = Date.now()
      const child = spawn(config.ffmpegPath, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      let stderr = ''
      const timer = setTimeout(() => child.kill('SIGKILL'), RUN_TIMEOUT_MS)

      // Пробы и замер не должны мешать серверу и тем, кто уже смотрит
      if (child.pid) {
        try {
          setPriority(child.pid, 10)
        }
        catch {}
      }

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-8000)
      })
      child.on('error', (err) => {
        clearTimeout(timer)
        resolve({ code: null, stderr: err.message, ms: Date.now() - started })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ code, stderr, ms: Date.now() - started })
      })
    })
  },
  async renderNodes() {
    const names = await readdir('/dev/dri').catch(() => [] as string[])

    return names
      .filter(name => /^renderD\d+$/.test(name))
      .sort()
      .map(name => `/dev/dri/${name}`)
  },
  /** Вывод `ffmpeg -encoders` или `-filters` */
  list(kind: '-encoders' | '-filters') {
    return new Promise<string>((resolve) => {
      execFile(
        config.ffmpegPath,
        ['-hide_banner', kind],
        { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
        (_err, stdout) => resolve(stdout ?? ''),
      )
    })
  },
  nvidiaName() {
    return new Promise<string | null>((resolve) => {
      execFile(
        'nvidia-smi',
        ['--query-gpu=name', '--format=csv,noheader'],
        { timeout: 5000 },
        (err, stdout) =>
          resolve(err ? null : stdout.split('\n')[0]?.trim() || null),
      )
    })
  },
}

const QUIET = ['-hide_banner', '-nostdin', '-v', 'error']

// Строка: ` V....D libx264  …` или ` TSC overlay  VV->V  …`
async function names(kind: '-encoders' | '-filters') {
  const output = await accelDeps.list(kind)

  return new Set(
    output
      .split('\n')
      .map(line => line.trim().split(/\s+/)[1])
      .filter((name): name is string => !!name),
  )
}
const TEST_SOURCE = ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25']

/** Образцы кодеков для проверки декодера видеокарты: ключ → кодировщик */
const SAMPLES: { key: string, encoder: string, args: string[] }[] = [
  { key: 'h264', encoder: 'libx264', args: ['-pix_fmt', 'yuv420p'] },
  { key: 'h26410', encoder: 'libx264', args: ['-pix_fmt', 'yuv420p10le'] },
  {
    key: 'hevc',
    encoder: 'libx265',
    args: ['-pix_fmt', 'yuv420p', '-x265-params', 'log-level=error'],
  },
  {
    key: 'hevc10',
    encoder: 'libx265',
    args: ['-pix_fmt', 'yuv420p10le', '-x265-params', 'log-level=error'],
  },
  { key: 'mpeg2video', encoder: 'mpeg2video', args: [] },
  { key: 'mpeg4', encoder: 'mpeg4', args: [] },
  {
    key: 'vp9',
    encoder: 'libvpx-vp9',
    args: ['-pix_fmt', 'yuv420p', '-deadline', 'realtime'],
  },
  {
    key: 'vp910',
    encoder: 'libvpx-vp9',
    args: ['-pix_fmt', 'yuv420p10le', '-deadline', 'realtime'],
  },
  { key: 'av1', encoder: 'libsvtav1', args: ['-pix_fmt', 'yuv420p'] },
  { key: 'av110', encoder: 'libsvtav1', args: ['-pix_fmt', 'yuv420p10le'] },
]

async function makeSamples(dir: string, encoders: Set<string>) {
  const made: { key: string, path: string }[] = []

  for (const sample of SAMPLES) {
    if (!encoders.has(sample.encoder))
      continue

    const path = join(dir, `${sample.key}.mkv`)
    const result = await accelDeps.run([
      ...QUIET,
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=320x240:r=25',
      '-frames:v',
      '10',
      '-c:v',
      sample.encoder,
      ...sample.args,
      path,
    ])

    if (result.code === 0)
      made.push({ key: sample.key, path })
  }

  return made
}

/**
 * Что декодирует видеокарта. ffmpeg без поддержки кодека молча декодирует
 * процессором, а фильтр видеокарты на таких кадрах падает: успех значит, что
 * кадры пришли из её памяти.
 */
async function gpuDecodes(
  encoder: GpuEncoder['encoder'],
  device: string | null,
  samples: { key: string, path: string }[],
) {
  const decode: string[] = []

  for (const sample of samples) {
    const args
      = encoder === 'vaapi'
        ? [
            '-hwaccel',
            'vaapi',
            '-hwaccel_device',
            device ?? '',
            '-hwaccel_output_format',
            'vaapi',
            '-i',
            sample.path,
            '-vf',
            'scale_vaapi=format=nv12',
          ]
        : [
            '-hwaccel',
            'cuda',
            '-hwaccel_output_format',
            'cuda',
            '-i',
            sample.path,
            '-vf',
            'scale_cuda=format=nv12',
          ]
    const result = await accelDeps.run([...QUIET, ...args, '-f', 'null', '-'])

    if (result.code === 0)
      decode.push(sample.key)
  }

  return decode
}

async function probeVaapi(device: string) {
  for (const lowPower of [false, true]) {
    const result = await accelDeps.run([
      '-hide_banner',
      '-nostdin',
      '-v',
      'verbose',
      '-init_hw_device',
      `vaapi=hw:${device}`,
      '-filter_hw_device',
      'hw',
      ...TEST_SOURCE,
      '-frames:v',
      '10',
      '-vf',
      'format=nv12,hwupload',
      '-c:v',
      'h264_vaapi',
      ...(lowPower ? ['-low_power', '1'] : []),
      '-f',
      'null',
      '-',
    ])

    if (result.code === 0) {
      const name
        = /VAAPI driver: ([^\n]*)/
          .exec(result.stderr)?.[1]
          ?.trim()
          .replace(/\.$/, '') || null

      return { lowPower, name }
    }
  }

  return null
}

async function probeNvenc() {
  const result = await accelDeps.run([
    ...QUIET,
    '-init_hw_device',
    'cuda=hw:0',
    ...TEST_SOURCE,
    '-frames:v',
    '10',
    '-c:v',
    'h264_nvenc',
    '-f',
    'null',
    '-',
  ])

  return result.code === 0
}

/** Скорость `libx264 veryfast` на 1080p — оценка CPU для потолка разрешения */
async function benchSoftware() {
  const result = await accelDeps.run([
    ...QUIET,
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=1920x1080:r=25',
    '-frames:v',
    String(BENCH_FRAMES),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-f',
    'null',
    '-',
  ])

  return result.code === 0 && result.ms > 0
    ? BENCH_FRAMES / (result.ms / 1000)
    : null
}

/** Потолок высоты кадра для процессора: 1080p, 720p или SD по замеру */
export function softwareCeiling(fps: number | null) {
  const needed = REALTIME_FPS * HEADROOM

  if (fps === null)
    return 720

  if (fps >= needed)
    return 1080

  if (fps / PIXELS_720_OF_1080 >= needed)
    return 720

  return SD_HEIGHT
}

const HDR_SOURCE
  = 'format=yuv420p10le,setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc'

async function probeToneMapping(filters: Set<string>, gpus: boolean) {
  if (!gpus || !filters.has('libplacebo'))
    return false

  const result = await accelDeps.run([
    ...QUIET,
    ...TEST_SOURCE,
    '-frames:v',
    '5',
    '-vf',
    [HDR_SOURCE, ...gpuToneMap(640, 360)].join(','),
    '-f',
    'null',
    '-',
  ])

  return result.code === 0
}

/**
 * Скорость перевода HDR → SDR на 1080p: на встроенной графике libplacebo
 * медленнее кодирования (N150 — 0,86× на 4K → 1080p), потолок для HDR свой.
 */
async function benchToneMapping(gpu: boolean) {
  const result = await accelDeps.run([
    ...QUIET,
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=1920x1080:r=25',
    '-frames:v',
    String(BENCH_FRAMES),
    '-vf',
    [
      HDR_SOURCE,
      ...(gpu ? gpuToneMap(1920, 1080) : softwareToneMap(1920, 1080)),
    ].join(','),
    '-f',
    'null',
    '-',
  ])

  return result.code === 0 && result.ms > 0
    ? BENCH_FRAMES / (result.ms / 1000)
    : null
}

export function accelMode(): AccelMode {
  return getSetting<AccelMode>(MODE_KEY) === 'software' ? 'software' : 'auto'
}

function chooseEncoder(
  mode: AccelMode,
  gpus: GpuEncoder[],
  software: boolean,
): VideoEncoder | null {
  if (mode === 'auto') {
    // NVENC быстрее и не делит память с процессором, как встроенная графика
    const gpu
      = gpus.find(item => item.encoder === 'nvenc')
        ?? gpus.find(item => item.encoder === 'vaapi')

    if (gpu)
      return gpu.encoder
  }

  return software ? 'software' : null
}

async function detect(): Promise<AccelState> {
  const [encoders, filters] = await Promise.all([
    names('-encoders'),
    names('-filters'),
  ])
  const gpus: GpuEncoder[] = []

  if (encoders.has('h264_nvenc') && (await probeNvenc())) {
    gpus.push({
      encoder: 'nvenc',
      device: null,
      name: await accelDeps.nvidiaName(),
      lowPower: false,
      decode: [],
    })
  }

  if (encoders.has('h264_vaapi')) {
    for (const device of await accelDeps.renderNodes()) {
      const found = await probeVaapi(device)

      if (found) {
        gpus.push({ encoder: 'vaapi', device, decode: [], ...found })
        // Одной встроенной графики хватает: вторая карта — обычно NVIDIA
        break
      }
    }
  }

  if (gpus.length > 0) {
    const dir = await mkdtemp(join(tmpdir(), 'torsher-accel-'))

    try {
      const samples = await makeSamples(dir, encoders)

      for (const gpu of gpus)
        gpu.decode = await gpuDecodes(gpu.encoder, gpu.device, samples)
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  const software = encoders.has('libx264')
  const softwareFps = software ? await benchSoftware() : null
  const mode = accelMode()
  const gpuToneMapping = await probeToneMapping(filters, gpus.length > 0)
  const softwareToneMapping = filters.has('zscale') && filters.has('tonemap')
  const toneMappingFps
    = gpuToneMapping || softwareToneMapping
      ? await benchToneMapping(gpuToneMapping)
      : null

  return {
    mode,
    encoder: chooseEncoder(mode, gpus, software),
    gpus,
    software,
    softwareFps,
    softwareMaxHeight: softwareCeiling(softwareFps),
    gpuToneMapping,
    softwareToneMapping,
    toneMappingFps,
    toneMappingMaxHeight: softwareCeiling(toneMappingFps),
    checkedAt: new Date().toISOString(),
  }
}

function describeState(state: AccelState) {
  const gpu = state.gpus.find(item => item.encoder === state.encoder)
  const parts = [
    `encoder=${state.encoder ?? 'none'}`,
    gpu?.device,
    gpu?.name,
    gpu && `decode=[${gpu.decode.join(', ')}]`,
    gpu?.lowPower && 'low-power',
    `software=${state.softwareMaxHeight}p${state.softwareFps ? ` (${state.softwareFps.toFixed(0)} fps)` : ''}`,
    `tonemap=${state.gpuToneMapping ? 'gpu' : state.softwareToneMapping ? 'software' : 'none'}${state.toneMappingFps ? ` ${state.toneMappingMaxHeight}p (${state.toneMappingFps.toFixed(0)} fps)` : ''}`,
  ]

  return parts.filter(Boolean).join(', ')
}

let detected: Promise<AccelState> | undefined

/** Детект ускорения: один раз на процесс, повторно — `recheckAccel` */
export function mediaAccel() {
  detected ??= detect()
    .then((state) => {
      logFor('playback').info(`Media acceleration: ${describeState(state)}`)
      return state
    })
    .catch((err: Error) => {
      detected = undefined
      throw err
    })

  return detected
}

export function recheckAccel() {
  detected = undefined
  return mediaAccel()
}

/** Режим меняет выбор сразу, без новых проб */
export async function setAccelMode(mode: AccelMode) {
  setSetting(MODE_KEY, mode)

  const state = await mediaAccel()
  const next = {
    ...state,
    mode,
    encoder: chooseEncoder(mode, state.gpus, state.software),
  }

  detected = Promise.resolve(next)
  return next
}

/** Тесты проверяют заново */
export function resetAccel() {
  detected = undefined
}

function toneMappingOf(state: AccelState): ToneMapping | null {
  if (state.gpuToneMapping)
    return 'gpu'

  return state.softwareToneMapping ? 'software' : null
}

/**
 * Возможности кодирования для плана: выбранный кодировщик и процессор —
 * запасной вариант, если видеокарта не запустится.
 */
export function encoderCapsOf(state: AccelState) {
  const toneMapping = toneMappingOf(state)
  const software: EncoderCaps | null = state.software
    ? {
        encoder: 'software',
        device: null,
        lowPower: false,
        decode: [],
        maxHeight: state.softwareMaxHeight,
        toneMapping,
        toneMappingMaxHeight: state.toneMappingMaxHeight,
      }
    : null
  const gpu = state.gpus.find(item => item.encoder === state.encoder)
  const caps: EncoderCaps | null = gpu
    ? {
        encoder: gpu.encoder,
        device: gpu.device,
        lowPower: gpu.lowPower,
        decode: gpu.decode,
        maxHeight: GPU_MAX_HEIGHT,
        toneMapping,
        toneMappingMaxHeight: state.toneMappingMaxHeight,
      }
    : software

  return { caps, software }
}
