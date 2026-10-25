import type { AttentionItem } from '../../dto/overview.ts'
import { and, eq, gt, isNotNull, isNull, lte } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { followEpisodes, follows, indexers } from '../../db/schema.ts'

// Лестница бэкоффа доходит до 6 ч за несколько ошибок, а 429 с `Retry-After`
// — сразу: о серии ошибок длиннее этого стоит знать
export const FEED_LIMITED_AFTER_MS = 6 * 60 * 60 * 1000

function hasActiveFollows() {
  return !!getDb()
    .select({ id: follows.id })
    .from(follows)
    .where(eq(follows.state, 'active'))
    .limit(1)
    .get()
}

/**
 * Серии действующих слежений ждут места. Нужно — сумма размеров их
 * кандидатов без повторов: у пака это весь пак, то есть оценка сверху.
 */
function noSpaceAttention(): AttentionItem[] {
  const rows = getDb()
    .select({ pending: followEpisodes.pending })
    .from(followEpisodes)
    .innerJoin(follows, eq(follows.id, followEpisodes.followId))
    .where(
      and(
        eq(follows.state, 'active'),
        eq(followEpisodes.stateNote, 'no_space'),
        isNull(followEpisodes.torrentId),
        isNotNull(followEpisodes.pending),
      ),
    )
    .all()

  if (!rows.length)
    return []

  const sizes = new Map(
    rows.map(row => [row.pending!.id, row.pending!.size] as const),
  )
  const need = [...sizes.values()].reduce<number | undefined>(
    (sum, size) => (size === undefined ? sum : (sum ?? 0) + size),
    undefined,
  )

  return [
    {
      kind: 'follow_no_space',
      severity: 'error',
      section: 'follow',
      params: { count: rows.length, ...(need && { need }) },
    },
  ]
}

/**
 * Индексатор с удачной проверкой, у которого фон ошибается подряд дольше
 * 6 ч: лента и целевой поиск его не читают. Индексатор с ошибкой проверки
 * уже в `indexer_error`, пропавший из менеджера — в `indexer_missing`.
 */
function feedAttention(now: Date): AttentionItem[] {
  const limited = getDb()
    .select({ name: indexers.name, checkStatus: indexers.checkStatus })
    .from(indexers)
    .where(
      and(
        eq(indexers.enabled, true),
        eq(indexers.missing, false),
        gt(indexers.failureCount, 0),
        lte(
          indexers.backoffSince,
          new Date(now.getTime() - FEED_LIMITED_AFTER_MS),
        ),
      ),
    )
    .all()
    .filter(row => !row.checkStatus || row.checkStatus === 'ok')

  if (!limited.length)
    return []

  return [
    {
      kind: 'follow_feed_limited',
      severity: 'warning',
      section: 'follow',
      params:
        limited.length === 1
          ? { count: 1, name: limited[0]!.name }
          : { count: limited.length },
    },
  ]
}

/**
 * Проблемы «Следить» для «Требует внимания»: по ним же монитор уведомлений
 * объявляет и снимает их. Без действующих слежений их нет: фон тогда не
 * ищет и не качает.
 */
export function followAttention(now = new Date()): AttentionItem[] {
  if (!hasActiveFollows())
    return []

  return [...noSpaceAttention(), ...feedAttention(now)]
}
