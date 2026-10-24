import type { AttentionMessageInput } from '@torsher/i18n'
import { attentionMessage } from '@torsher/i18n'
import { formatBytes } from '~/lib/format'

type Translate = (
  key: string,
  params?: Record<string, unknown>,
  plural?: number,
) => string

/**
 * Текст проблемы «Требует внимания» — общий для «Обзора» и центра
 * уведомлений; сервер собирает те же строки для внешних каналов.
 */
export function attentionText(
  t: Translate,
  locale: string,
  item: AttentionMessageInput,
) {
  const message = attentionMessage(item)
  const params: Record<string, unknown> = { ...message.params }

  if (typeof params.free === 'number')
    params.free = formatBytes(params.free, locale)

  if (typeof params.minFree === 'number')
    params.minFree = formatBytes(params.minFree, locale)

  if (message.count === undefined)
    return t(message.key, params)

  return t(message.key, { n: message.count, ...params }, message.count)
}
