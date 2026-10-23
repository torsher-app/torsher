import type { EncodePlan, EncoderCaps } from './encode.ts'
import type { VideoStreamInfo } from './probe.ts'
import { describe, expect, it } from 'vitest'
import {
  describePlan,
  encodeFilterGraph,
  encodeInputArgs,
  encodeOutputArgs,
  outputSize,
  planEncode,
} from './encode.ts'

const xvid: VideoStreamInfo = {
  index: 0,
  codec: 'mpeg4',
  profile: 'Advanced Simple Profile',
  width: 720,
  height: 400,
  highBitDepth: false,
  hdr: false,
  frameRate: 25,
  interlaced: false,
  bitrate: 1_700_000,
  pixelAspect: 1,
}

// HEVC 10 бит 4K HDR — то, что браузер без декодера не сыграет
const uhd: VideoStreamInfo = {
  index: 0,
  codec: 'hevc',
  profile: 'Main 10',
  width: 3840,
  height: 2160,
  highBitDepth: true,
  hdr: true,
  frameRate: 23.976,
  interlaced: false,
  bitrate: 40_000_000,
  pixelAspect: 1,
}

const software: EncoderCaps = {
  encoder: 'software',
  device: null,
  lowPower: false,
  decode: [],
  maxHeight: 720,
  toneMapping: 'software',
  toneMappingMaxHeight: 720,
}

const vaapi: EncoderCaps = {
  encoder: 'vaapi',
  device: '/dev/dri/renderD128',
  lowPower: true,
  decode: ['h264', 'hevc', 'hevc10'],
  maxHeight: 1080,
  toneMapping: 'gpu',
  toneMappingMaxHeight: 1080,
}

const nvenc: EncoderCaps = {
  ...vaapi,
  encoder: 'nvenc',
  device: null,
  lowPower: false,
}

describe('outputSize', () => {
  it('ниже потолка — как есть', () => {
    expect(outputSize(xvid, 720)).toEqual({ width: 720, height: 400 })
  })

  it('выше потолка — по высоте с пропорциями', () => {
    expect(outputSize(uhd, 1080)).toEqual({ width: 1920, height: 1080 })
  })

  it('широкий кадр упирается в ширину 16:9 потолка', () => {
    expect(outputSize({ ...uhd, width: 3840, height: 1600 }, 720)).toEqual({
      width: 1280,
      height: 534,
    })
  })

  it('неквадратный пиксель DVD — в пропорциях экрана', () => {
    expect(
      outputSize(
        { ...xvid, width: 720, height: 576, pixelAspect: 64 / 45 },
        720,
      ),
    ).toEqual({ width: 1024, height: 576 })
  })
})

describe('planEncode', () => {
  it('xvid процессором: без масштаба, битрейт исходника', () => {
    expect(planEncode(xvid, software, null, null)).toMatchObject({
      encoder: 'software',
      hwDecode: false,
      width: 720,
      height: 400,
      scale: false,
      bitrate: 1_700_000,
      fallback: null,
    })
  })

  it('4K HDR на VAAPI: декодер видеокарты, 1080p, tone mapping, откат до процессора', () => {
    const plan = planEncode(uhd, vaapi, null, software)

    expect(plan).toMatchObject({
      encoder: 'vaapi',
      hwDecode: true,
      width: 1920,
      height: 1080,
      toneMapping: 'gpu',
      bitrate: 10_000_000,
    })
    expect(plan.fallback).toMatchObject({ encoder: 'vaapi', hwDecode: false })
    expect(plan.fallback?.fallback).toMatchObject({
      encoder: 'software',
      height: 720,
      fallback: null,
    })
  })

  it('кодек, который видеокарта не декодирует, — сразу процессором декодирует', () => {
    const plan = planEncode(xvid, vaapi, null, software)

    expect(plan.hwDecode).toBe(false)
    expect(plan.fallback).toMatchObject({ encoder: 'software' })
  })

  it('hDR — по своему потолку: перевод в SDR дороже кодирования', () => {
    const n150 = { ...vaapi, toneMappingMaxHeight: 720 }

    expect(planEncode(uhd, n150, null, null)).toMatchObject({
      width: 1280,
      height: 720,
      toneMapping: 'gpu',
    })
    expect(planEncode({ ...uhd, hdr: false }, n150, null, null)).toMatchObject({
      width: 1920,
      height: 1080,
    })
  })

  it('hDR без tone mapping отмечен', () => {
    expect(
      planEncode(uhd, { ...software, toneMapping: null }, null, null),
    ).toMatchObject({ toneMapping: null, hdrUntouched: true })
  })
})

function plan(
  caps: EncoderCaps,
  video: VideoStreamInfo,
  burn: number | null = null,
): EncodePlan {
  return planEncode(video, caps, burn, null)
}

describe('encodeFilterGraph', () => {
  it('процессор: только формат', () => {
    expect(encodeFilterGraph(plan(software, xvid), 0)).toBe(
      '[0:0]format=yuv420p[v]',
    )
  })

  it('процессор: деинтерлейс, масштаб', () => {
    expect(
      encodeFilterGraph(
        plan(software, {
          ...xvid,
          width: 1920,
          height: 1080,
          interlaced: true,
        }),
        0,
      ),
    ).toBe('[0:0]yadif,scale=1280:720,format=yuv420p[v]')
  })

  it('процессор: HDR → SDR со своим масштабом', () => {
    expect(encodeFilterGraph(plan(software, uhd), 0)).toBe(
      '[0:0]zscale=w=1280:h=720:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p[v]',
    )
  })

  it('vAAPI с декодером: всё на видеокарте', () => {
    const sdr = { ...uhd, hdr: false }

    expect(encodeFilterGraph(plan(vaapi, sdr), 0)).toBe(
      '[0:0]scale_vaapi=w=1920:h=1080:format=nv12[v]',
    )
    expect(
      encodeFilterGraph(plan(vaapi, { ...sdr, interlaced: true }), 0),
    ).toBe('[0:0]deinterlace_vaapi,scale_vaapi=w=1920:h=1080:format=nv12[v]')
  })

  it('vAAPI без декодера: кадры загружаются в видеокарту', () => {
    expect(encodeFilterGraph(plan(vaapi, xvid), 0)).toBe(
      '[0:0]format=nv12,hwupload[v]',
    )
  })

  it('vAAPI и HDR: уменьшение на видеокарте, выгрузка для libplacebo и загрузка обратно', () => {
    expect(encodeFilterGraph(plan(vaapi, uhd), 0)).toBe(
      '[0:0]scale_vaapi=w=1920:h=1080:format=p010le,hwdownload,format=p010le,libplacebo=w=1920:h=1080:tonemapping=bt.2390:peak_detect=0:dithering=none:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:format=yuv420p,format=nv12,hwupload[v]',
    )
  })

  it('nVENC с декодером и деинтерлейсом', () => {
    expect(
      encodeFilterGraph(
        plan(nvenc, { ...uhd, hdr: false, interlaced: true }),
        0,
      ),
    ).toBe('[0:0]yadif_cuda,scale_cuda=w=1920:h=1080:format=nv12[v]')
  })

  it('nVENC без декодера берёт кадры из памяти процессора', () => {
    expect(encodeFilterGraph(plan(nvenc, xvid), 0)).toBe('[0:0]format=nv12[v]')
  })

  it('прожиг субтитров: наложение на кадр выхода', () => {
    expect(encodeFilterGraph(plan(software, xvid, 3), 0)).toBe(
      [
        '[0:0]format=yuv420p[base]',
        '[0:3]scale=720:400[sub]',
        '[base][sub]overlay=eof_action=pass:repeatlast=0,format=yuv420p[v]',
      ].join(';'),
    )
    expect(encodeFilterGraph(plan(vaapi, { ...uhd, hdr: false }, 4), 0)).toBe(
      [
        '[0:0]scale_vaapi=w=1920:h=1080:format=p010le,hwdownload,format=p010le,format=yuv420p[base]',
        '[0:4]scale=1920:1080[sub]',
        '[base][sub]overlay=eof_action=pass:repeatlast=0,format=nv12,hwupload[v]',
      ].join(';'),
    )
  })
})

describe('encodeInputArgs', () => {
  it('процессору ничего не нужно', () => {
    expect(encodeInputArgs(plan(software, xvid))).toEqual([])
  })

  it('vAAPI: устройство и декодер', () => {
    expect(encodeInputArgs(plan(vaapi, uhd))).toEqual([
      '-init_hw_device',
      'vaapi=hw:/dev/dri/renderD128',
      '-filter_hw_device',
      'hw',
      '-hwaccel',
      'vaapi',
      '-hwaccel_device',
      'hw',
      '-hwaccel_output_format',
      'vaapi',
    ])
  })

  it('nVENC без декодера — только устройство', () => {
    expect(encodeInputArgs(plan(nvenc, xvid))).toEqual([
      '-init_hw_device',
      'cuda=hw:0',
      '-filter_hw_device',
      'hw',
    ])
  })
})

describe('encodeOutputArgs', () => {
  it('x264: пресет Jellyfin, ключевые кадры на границах', () => {
    const args = encodeOutputArgs(plan(software, xvid), [596, 602, 608])

    expect(args).toEqual(
      expect.arrayContaining(['libx264', 'veryfast', '-sc_threshold', '0']),
    )
    expect(args.slice(-4)).toEqual([
      '-aspect',
      '720:400',
      '-force_key_frames',
      '596.000,602.000,608.000',
    ])
  })

  it('vAAPI low-power', () => {
    expect(encodeOutputArgs(plan(vaapi, uhd), [0])).toEqual(
      expect.arrayContaining([
        'h264_vaapi',
        '-low_power',
        '1',
        '-maxrate',
        '10000000',
      ]),
    )
  })

  it('nVENC: GOP 2 с по частоте кадров', () => {
    const args = encodeOutputArgs(plan(nvenc, uhd), [0])

    expect(args[args.indexOf('-g') + 1]).toBe('48')
    expect(args).toContain('-forced-idr')
  })
})

describe('describePlan', () => {
  it('коротко для журнала', () => {
    expect(describePlan(plan(vaapi, uhd, 3))).toBe(
      'vaapi+decode, 1920x1080, tonemap=gpu, burn=s3',
    )
  })
})
