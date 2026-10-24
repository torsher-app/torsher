import type { RunResult } from './accel.ts'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { migrateDb } from '../../db/index.ts'
import {
  accelDeps,
  accelSnapshot,
  describeAccel,
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
  /** Карты NVIDIA, смонтированные в контейнер */
  nvidia?: string[]
}

function fake({ works, benchMs = 500, nvidia = [] }: Fake) {
  const calls: string[] = []

  vi.spyOn(accelDeps, 'list').mockImplementation(async kind =>
    kind === '-encoders' ? ENCODERS : FILTERS,
  )
  vi.spyOn(accelDeps, 'renderNodes').mockResolvedValue(['/dev/dri/renderD128'])
  vi.spyOn(accelDeps, 'nvidiaDevices').mockResolvedValue(nvidia)
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
        : {
            code: 1,
            stderr: [
              '[h264_vaapi @ 0x5581d2c0] No usable encoding entrypoint found for profile VAProfileH264High (7).',
              'Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.',
              'Conversion failed!',
            ].join('\n'),
            ms: 10,
          }
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
        name: 'Intel iHD driver for Intel(R) Gen Graphics - 25.2.3',
        vendor: 'intel',
        lowPower: true,
        decode: ['h264', 'hevc', 'hevc10'],
      },
    ])
    expect(state.failed).toEqual([])
    expect(accelSnapshot()).toBe(state)
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
    expect(state.failed).toEqual([
      {
        encoder: 'vaapi',
        device: '/dev/dri/renderD128',
        error:
          '[h264_vaapi] No usable encoding entrypoint found for profile VAProfileH264High (7).',
      },
    ])
    expect(calls.some(line => line.endsWith('.mkv'))).toBe(false)
    expect(encoderCapsOf(state).caps).toMatchObject({ encoder: 'software' })
  })

  it('nVENC без карты в контейнере — не сбой, с картой — сбой', async () => {
    fake({ works: line => line.includes('h264_vaapi') })
    expect((await mediaAccel()).failed).toEqual([])

    vi.restoreAllMocks()
    resetAccel()
    fake({
      works: line => line.includes('h264_vaapi'),
      nvidia: ['/dev/nvidia0'],
    })

    const state = await mediaAccel()

    expect(state.encoder).toBe('vaapi')
    expect(state.failed).toMatchObject([
      { encoder: 'nvenc', device: '/dev/nvidia0' },
    ])
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

describe('describeAccel', () => {
  const base = {
    mode: 'auto' as const,
    software: true,
    softwareFps: 59.4,
    softwareMaxHeight: 1080,
    gpuToneMapping: true,
    softwareToneMapping: true,
    toneMappingFps: 27.2,
    toneMappingMaxHeight: 720,
    checkedAt: '2026-10-24T00:00:00.000Z',
  }
  const gpu = {
    encoder: 'vaapi' as const,
    device: '/dev/dri/renderD128',
    name: 'Intel iHD driver for Intel(R) Gen Graphics - 25.2.3',
    vendor: 'intel' as const,
    lowPower: true,
    decode: ['h264', 'hevc10', 'vp9'],
  }

  it('видеокарта: что кодирует, что декодирует, процессор и HDR', () => {
    expect(
      describeAccel({ ...base, encoder: 'vaapi', gpus: [gpu], failed: [] }),
    ).toBe(
      'Video acceleration: Intel GPU via VAAPI low-power on /dev/dri/renderD128 (Intel iHD driver for Intel(R) Gen Graphics - 25.2.3); GPU decodes H.264, HEVC 10-bit, VP9; CPU encodes up to 1080p (59 fps at 1080p); HDR to SDR on GPU up to 720p (27 fps at 1080p)',
    )
  })

  it('видеокарта выключена в настройках', () => {
    expect(
      describeAccel({
        ...base,
        mode: 'software',
        encoder: 'software',
        gpus: [gpu],
        failed: [],
      }),
    ).toContain('off in settings, found Intel GPU via VAAPI low-power')
  })

  it('видеокарты нет и видеокарта не прошла проверку', () => {
    const none = {
      ...base,
      encoder: 'software' as const,
      gpus: [],
      gpuToneMapping: false,
    }

    expect(describeAccel({ ...none, failed: [] })).toMatch(
      /^Video acceleration: no GPU visible to the server; CPU encodes up to 1080p .+; HDR to SDR on CPU up to 720p/,
    )
    expect(
      describeAccel({
        ...none,
        failed: [
          {
            encoder: 'vaapi',
            device: '/dev/dri/renderD128',
            error: 'Failed to initialise VAAPI connection: -1',
          },
        ],
      }),
    ).toMatch(
      /^Video acceleration: VAAPI on \/dev\/dri\/renderD128 failed the test: Failed to initialise VAAPI connection: -1; CPU encodes/,
    )
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
