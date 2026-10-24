import type { NotificationParams } from '../../dto/notifications.ts'
import type { AttentionItem } from '../../dto/overview.ts'
import type { Notification } from './inbox.ts'
import { logFor } from '../logs/index.ts'
import { notify, notifyResolved } from './index.ts'
import {
  markResolutionSent,
  openProblems,
  pendingResolutions,
  reopenNotification,
  resolveNotification,
  updateNotificationParams,
} from './inbox.ts'

type ProblemKind = AttentionItem['kind']

// Проблема должна продержаться две проверки подряд: движок перезапускается
// за секунды, сеть моргает — о таком сообщать не нужно
const CONFIRM_TICKS = 2
// После старта сервис ещё поднимается: стартовые проблемы объявляются
// одним проходом по окончании льготного периода
export const STARTUP_GRACE_MS = 5 * 60 * 1000
// Вернулась вскоре после решения — дребезг: строка в центре открывается
// снова, а внешнее «решено» уходит, только если окно прошло без повтора
export const REOPEN_QUIET_MS = 10 * 60 * 1000
// Отложенное «решено» старше суток после перезапуска уже не новость
export const RESOLUTION_MAX_AGE_MS = 24 * 60 * 60 * 1000
// Источник этих проблем обновляется раз в 30 минут: две минутные проверки
// видят один и тот же результат. При появлении источник перепроверяется,
// и проблема объявляется, только если пережила перепроверку
const RECHECKED_KINDS = new Set<ProblemKind>([
  'indexer_error',
  'indexer_missing',
  'host_unreachable',
  'dns_spoofing',
])
// Зависшая перепроверка через столько считается законченной: иначе
// проблема не объявится никогда
export const RECHECK_TIMEOUT_MS = 5 * 60 * 1000

interface Recheck {
  // Время завершения (успехом или ошибкой); до него результата ещё нет
  doneAt?: number
}

interface Tracked {
  present: number
  absent: number
  recheck?: Recheck
}

interface OpenProblem {
  row: Notification
}

interface ResolvedProblem {
  row: Notification
  at: number
}

export interface ProblemMonitorOptions {
  startedAt: number
  // Проверить источник проблемы заново и дождаться результата: он придёт
  // в «Требует внимания» следующего тика
  recheck?: (kind: ProblemKind) => Promise<unknown> | unknown
}

function paramsOf(item: AttentionItem): NotificationParams {
  return { ...item.params }
}

function sameParams(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Запуск движка после старта или падения проходит сам — это не проблема */
function isProblem(item: AttentionItem) {
  return !(item.kind === 'engine_down' && item.params.reason === 'starting')
}

/**
 * Переходы «Требует внимания» в события: проблема объявляется один раз при
 * появлении и один раз при решении, как health-проверки *arr. Состояние
 * открытых проблем — строки центра без `resolved_at`, поэтому перезапуск
 * сервера их не повторяет.
 */
export function createProblemMonitor(options: ProblemMonitorOptions) {
  const tracked = new Map<ProblemKind, Tracked>()
  const open = new Map<ProblemKind, OpenProblem>()
  // Решённые, чьё «решено» ещё не ушло наружу (`resolution_sent_at` пуст)
  const resolved = new Map<ProblemKind, ResolvedProblem>()

  for (const row of openProblems()) {
    if (row.problem)
      open.set(row.problem as ProblemKind, { row })
  }

  // Решённые до перезапуска, чьё «решено» не успело уйти: окно тишины
  // продолжается от `resolved_at`
  for (const row of pendingResolutions(
    new Date(Date.now() - RESOLUTION_MAX_AGE_MS),
  )) {
    const kind = row.problem as ProblemKind

    if (row.resolvedAt && !open.has(kind))
      resolved.set(kind, { row, at: row.resolvedAt.getTime() })
  }

  function startRecheck(kind: ProblemKind, state: Tracked, now: number) {
    const recheck: Recheck = {}

    state.recheck = recheck

    if (!options.recheck) {
      recheck.doneAt = now

      return
    }

    const timer = setTimeout(() => {
      recheck.doneAt = Date.now()
      logFor('notifications').warn({ kind }, 'Problem recheck timed out')
    }, RECHECK_TIMEOUT_MS)

    timer.unref()

    // Ошибка — тоже конец перепроверки: иначе проблема не объявится никогда
    void Promise.resolve()
      .then(() => options.recheck?.(kind))
      .catch(err =>
        logFor('notifications').warn({ err, kind }, 'Problem recheck failed'),
      )
      .finally(() => {
        clearTimeout(timer)
        recheck.doneAt ??= Date.now()
      })
  }

  function confirmed(kind: ProblemKind, state: Tracked, now: number) {
    if (state.present < CONFIRM_TICKS)
      return false

    if (!RECHECKED_KINDS.has(kind))
      return true

    // `now` — момент, с которого собран список тика: перепроверка,
    // закончившаяся позже, в нём ещё не видна
    const doneAt = state.recheck?.doneAt

    return doneAt !== undefined && doneAt <= now
  }

  function raise(item: AttentionItem) {
    const recent = resolved.get(item.kind)

    // «Решено» наружу не ушло: для каналов проблема так и не кончалась
    if (recent) {
      reopenNotification(recent.row.id, paramsOf(item))
      open.set(item.kind, {
        row: {
          ...recent.row,
          resolvedAt: null,
          resolutionSentAt: null,
          params: paramsOf(item),
        },
      })
      resolved.delete(item.kind)

      return
    }

    const row = notify({
      kind: 'problem',
      problem: item.kind,
      severity: item.severity,
      section: item.section,
      params: paramsOf(item),
    })

    open.set(item.kind, { row })
  }

  function resolve(kind: ProblemKind, problem: OpenProblem, now: number) {
    resolveNotification(problem.row.id, new Date(now))
    open.delete(kind)
    resolved.set(kind, { row: problem.row, at: now })
  }

  return {
    tick(items: AttentionItem[], now = Date.now()) {
      const current = new Map(
        items.filter(isProblem).map(item => [item.kind, item] as const),
      )
      const settled = now - options.startedAt >= STARTUP_GRACE_MS

      for (const [kind, item] of current) {
        const state = tracked.get(kind) ?? { present: 0, absent: 0 }

        state.present += 1
        state.absent = 0
        tracked.set(kind, state)

        const problem = open.get(kind)

        if (problem) {
          // Число индексаторов и свободное место меняются, проблема — та же
          if (!sameParams(problem.row.params, paramsOf(item))) {
            updateNotificationParams(problem.row.id, paramsOf(item))
            problem.row = { ...problem.row, params: paramsOf(item) }
          }

          continue
        }

        if (RECHECKED_KINDS.has(kind) && !state.recheck)
          startRecheck(kind, state, now)

        if (settled && confirmed(kind, state, now))
          raise(item)
      }

      for (const [kind, state] of tracked) {
        if (current.has(kind))
          continue

        state.present = 0
        state.absent += 1
        state.recheck = undefined
      }

      for (const [kind, problem] of open) {
        if (current.has(kind))
          continue

        const state = tracked.get(kind) ?? { present: 0, absent: 0 }

        // Открытая с прошлого запуска и не увиденная — тоже считается
        if (!tracked.has(kind)) {
          state.absent = 1
          tracked.set(kind, state)
        }

        if (settled && state.absent >= CONFIRM_TICKS)
          resolve(kind, problem, now)
      }

      for (const [kind, recent] of resolved) {
        // Поднятое после перезапуска ждёт конца льготного периода: за него
        // видно, не вернулась ли проблема
        if (!settled || current.has(kind) || now - recent.at < REOPEN_QUIET_MS)
          continue

        resolved.delete(kind)
        markResolutionSent(recent.row.id, new Date(now))
        notifyResolved({ ...recent.row, resolvedAt: new Date(recent.at) })
      }
    },
  }
}
