/** Проблема «Требует внимания» в том виде, в каком её знает сервер */
export interface AttentionMessageInput {
  kind: string
  params: {
    count?: number
    name?: string
    reason?: string
    free?: number
    minFree?: number
  }
}

export interface AttentionMessage {
  key: string
  params: Record<string, string | number | undefined>
  count?: number
}

/**
 * Какой строкой описать проблему: у проблемы с одним элементом — его имя,
 * иначе — число. Общая для «Обзора», центра уведомлений и сообщений сервера.
 * Байты (`free`, `minFree`) форматирует вызывающий: у панели и сервера свой формат.
 */
export function attentionMessage(
  item: AttentionMessageInput,
): AttentionMessage {
  const key = `panel.overview.attention.${item.kind}`
  const { count = 0, name, reason, free, minFree } = item.params

  switch (item.kind) {
    case 'engine_down':
    case 'tmdb_key_invalid':
      return { key: `${key}.${reason}`, params: {} }
    case 'engine_crashed':
      return { key, params: {}, count }
    case 'storage_low':
      return { key, params: { free, minFree } }
    case 'library_copies':
    case 'media_accel_failed':
      return { key, params: {} }
    default:
      return name
        ? { key: `${key}.one`, params: { name } }
        : { key: `${key}.many`, params: {}, count }
  }
}
