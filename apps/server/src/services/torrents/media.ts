// Контейнеры, которые плеер может хотя бы попытаться открыть напрямую.
// Поддержку кодеков решает клиент: remux и транскод появятся позже
const VIDEO_TYPES: Record<string, string> = {
  'mp4': 'video/mp4',
  'm4v': 'video/mp4',
  'mkv': 'video/x-matroska',
  'webm': 'video/webm',
  'mov': 'video/quicktime',
  'avi': 'video/x-msvideo',
  'ts': 'video/mp2t',
  'm2ts': 'video/mp2t',
  'mpg': 'video/mpeg',
  'mpeg': 'video/mpeg',
  'wmv': 'video/x-ms-wmv',
  'ogv': 'video/ogg',
  '3gp': 'video/3gpp',
}

function extensionOf(path: string) {
  const name = path.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')

  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isVideoFile(path: string) {
  return extensionOf(path) in VIDEO_TYPES
}

export function contentTypeOf(path: string) {
  return VIDEO_TYPES[extensionOf(path)] ?? 'application/octet-stream'
}

export function fileNameOf(path: string) {
  return path.split('/').pop() ?? path
}
