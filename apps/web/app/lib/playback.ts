const CODECS: Record<string, string> = {
  h264: 'H.264',
  hevc: 'HEVC',
  mpeg2video: 'MPEG-2',
  mpeg4: 'MPEG-4',
  vp9: 'VP9',
  av1: 'AV1',
}

/** Ключ декодера сервера (`hevc10`) → кодек и разрядность для подписи */
export function decodeLabelOf(key: string) {
  const deep = key.endsWith('10')
  const codec = deep ? key.slice(0, -2) : key

  return { codec: CODECS[codec] ?? codec.toUpperCase(), deep }
}
