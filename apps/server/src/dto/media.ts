import { z } from 'zod'

export const accelModes = ['auto', 'software'] as const

const gpuEncoder = z
  .object({
    encoder: z.enum(['vaapi', 'nvenc']),
    // VAAPI: `/dev/dri/renderD*`
    device: z.string().nullable(),
    // Драйвер VAAPI или модель NVIDIA
    name: z.string().nullable(),
    // Кодирует только в режиме low-power (VDEnc)
    lowPower: z.boolean(),
    // Что декодирует сама: `h264`, `hevc`, `hevc10`, `av1`…
    decode: z.array(z.string()),
  })
  .meta({ id: 'gpuEncoder' })

/** Ускорение перекодирования: что найдено на сервере и что выбрано */
export const playbackSettings = z
  .object({
    // `auto` — видеокарта, если есть; `software` — только процессор
    accel: z.enum(accelModes),
    // Чем кодируется сейчас; null — кодировщика H.264 нет совсем
    encoder: z.enum(['software', 'vaapi', 'nvenc']).nullable(),
    gpus: z.array(gpuEncoder),
    software: z.boolean(),
    // Кадров в секунду x264 на 1080p по замеру и потолок кадра процессора
    softwareFps: z.number().nullable(),
    softwareMaxHeight: z.number(),
    gpuToneMapping: z.boolean(),
    softwareToneMapping: z.boolean(),
    // Кадров в секунду перевода HDR → SDR на 1080p и потолок кадра для HDR
    toneMappingFps: z.number().nullable(),
    toneMappingMaxHeight: z.number(),
    checkedAt: z.string(),
  })
  .meta({ id: 'playbackSettings' })

export const updatePlaybackSettings = z
  .object({ accel: z.enum(accelModes) })
  .meta({ id: 'updatePlaybackSettings' })
