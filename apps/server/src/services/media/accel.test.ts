import type { RunResult } from './accel.ts'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { migrateDb } from '../../db/index.ts'
import {
  accelDeps,
  encoderCapsOf,
  mediaAccel,
  resetAccel,
  setAccelMode,
  softwareCeiling,
} from './accel.ts'

const ENCODERS = [
  'Encoders:',
  ' V....D libx264              libx264 H.264',
  ' V....D libx265              libx265 H.265',
  ' V....D mpeg4                MPEG-4 part 2',
  ' V....D h264_vaapi           H.264/AVC (VAAPI)',
  ' V....D h264_nvenc           NVIDIA NVENC H.264 encoder',
].join('\n')

const FILTERS = [
  'Filters:',
  ' TSC overlay           VV->V      Overlay a video source',
  ' .SC zscale            V->V       Apply resizing',
  ' .S. tonemap           V->V       Conversion',
  ' ... libplacebo        N->V       Apply various GPU filters',
].join('\n')

interface Fake {
  /** Что «умеет» видеокарта: вызов ffmpeg с этим фрагментом успешен */
  works: (args: string) => boolean
  benchMs?: number
}

function fake({ works, benchMs = 500 }: Fake) {
  const calls: string[] = []

  vi.spyOn(accelDeps, 'list').mockImplementation(async kind =>
    kind === '-encoders' ? ENCODERS : FILTERS,
  )
  vi.spyOn(accelDeps, 'renderNodes').mockResolvedValue(['/dev/dri/renderD128'])
  vi.spyOn(accelDeps, 'nvidiaName').mockResolvedValue(
    'NVIDIA GeForce RTX 3080',
  )
  vi.spyOn(accelDeps, 'run').mockImplementation(
    async (args): Promise<RunResult> => {
      const line = args.join(' ')

      calls.push(line)

      // Образцы кодеков для проверки декодера собираются процессором
      if (/\.mkv$/.test(line) && !line.includes('-hwaccel'))
        return { code: 0, stderr: '', ms: 10 }

      if (line.includes('testsrc2=s=1920x1080'))
        return { code: 0, stderr: '', ms: benchMs }

      return works(line)
        ? {
            code: 0,
            stderr:
              '[AVHWDeviceContext] VAAPI driver: Intel iHD driver for Intel(R) Gen Graphics - 25.2.3 ().\n',
            ms: 10,
          }
        : { code: 1, stderr: 'failed', ms: 10 }
    },
  )

  return calls
}

describe('детект ускорения', () => {
  beforeAll(() => migrateDb())

  afterEach(async () => {
    vi.restoreAllMocks()
    resetAccel()
    await setAccelMode('auto').catch(() => {})
    resetAccel()
  })

  it('n150: VAAPI только в low-power, декодирует H.264 и HEVC', async () => {
    fake({
      works: line =>
        (line.includes('h264_vaapi') && line.includes('-low_power 1'))
        || (line.includes('scale_vaapi')
          && /\/(?:h264|hevc|hevc10)\.mkv/.test(line)),
    })

    const state = await mediaAccel()

    expect(state).toMatchObject({
      encoder: 'vaapi',
      software: true,
      gpuToneMapping: false,
      softwareToneMapping: true,
    })
    expect(state.gpus).toEqual([
      {
        encoder: 'vaapi',
        device: '/dev/dri/renderD128',
        name: 'Intel iHD driver for Intel(R) Gen Graphics - 25.2.3 ()',
        lowPower: true,
        decode: ['h264', 'hevc', 'hevc10'],
      },
    ])
    expect(encoderCapsOf(state).caps).toMatchObject({
      encoder: 'vaapi',
      lowPower: true,
      maxHeight: 1080,
      toneMapping: 'software',
      toneMappingMaxHeight: 1080,
    })
  })

  it('nVIDIA раньше встроенной графики', async () => {
    fake({ works: () => true })

    const state = await mediaAccel()

    expect(state.encoder).toBe('nvenc')
    expect(state.gpus.map(gpu => gpu.encoder)).toEqual(['nvenc', 'vaapi'])
    expect(state.gpuToneMapping).toBe(true)
    expect(state.gpus[0]!.name).toBe('NVIDIA GeForce RTX 3080')
  })

  it('без видеокарты — процессор, образцы не собираются', async () => {
    const calls = fake({ works: () => false })
    const state = await mediaAccel()

    expect(state).toMatchObject({ encoder: 'software', gpus: [] })
    expect(calls.some(line => line.endsWith('.mkv'))).toBe(false)
    expect(encoderCapsOf(state).caps).toMatchObject({ encoder: 'software' })
  })

  it('«только процессор» — видеокарта найдена, но не используется', async () => {
    fake({ works: line => line.includes('h264_vaapi') })

    const state = await setAccelMode('software')

    expect(state).toMatchObject({ mode: 'software', encoder: 'software' })
    expect(state.gpus).toHaveLength(1)

    resetAccel()
    expect((await mediaAccel()).mode).toBe('software')
  })
})

describe('softwareCeiling', () => {
  it('по скорости x264 на 1080p: вдвое быстрее 25 к/с', () => {
    expect(softwareCeiling(60)).toBe(1080)
    expect(softwareCeiling(30)).toBe(720)
    expect(softwareCeiling(15)).toBe(576)
    expect(softwareCeiling(null)).toBe(720)
  })
})
