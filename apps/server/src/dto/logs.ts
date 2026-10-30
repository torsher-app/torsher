import { z } from 'zod'
import { LOG_LEVELS, LOG_SOURCES } from '../services/logs/index.ts'

const sourceList = new RegExp(
  `^(?:${LOG_SOURCES.join('|')})(?:,(?:${LOG_SOURCES.join('|')}))*$`,
)

export const logsQuery = z.object({
  // Минимальный уровень: `warn` — предупреждения и ошибки
  level: z.enum(LOG_LEVELS).optional(),
  // Один или несколько источников через запятую
  source: z.string().regex(sourceList).optional(),
  // Подстрока сообщения или значения поля (id раздачи, сессии, тайтла) без
  // учёта регистра
  q: z.string().max(200).optional(),
  // Курсоры по `seq`: `before` — страница старше, `after` — новые записи
  before: z.coerce.number().int().min(0).optional(),
  after: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

export const logEntry = z
  .object({
    // Постоянный номер записи; у склеенных повторов — номер первой
    id: z.number(),
    // Позиция для курсоров: склейка повтора выдаёт новую, и запись снова
    // самая свежая. После перезапуска сервера нумерация новая
    seq: z.number(),
    time: z.string(),
    level: z.enum(LOG_LEVELS),
    source: z.enum(LOG_SOURCES),
    message: z.string(),
    details: z.string().optional(),
    // Плоские поля записи: id раздачи, сессии, код выхода и т. п.
    context: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
    // Сколько раз подряд пришла та же запись
    repeat: z.number().optional(),
  })
  .meta({ id: 'logEntry' })

export const logsResponse = z
  .object({
    // Новые сверху
    entries: z.array(logEntry),
    level: z.enum(LOG_LEVELS),
    // Уровень задан переменной LOG_LEVEL: из панели не меняется
    levelLocked: z.boolean(),
    hasMore: z.boolean(),
    // Id журнала процесса: сменился — курсоры `seq` от прошлого запуска не годятся
    instance: z.string(),
  })
  .meta({ id: 'logsResponse' })

export const logLevelBody = z
  .object({ level: z.enum(['info', 'debug']) })
  .meta({ id: 'logLevelBody' })

export const logLevelResponse = z
  .object({ level: z.enum(LOG_LEVELS) })
  .meta({ id: 'logLevelResponse' })
