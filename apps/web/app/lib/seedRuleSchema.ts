import * as z from 'zod'
import {
  DAY_MINUTES,
  DEFAULT_RULE,
  fieldNumber,
  SEED_MODES,
  seedMinutes,
} from './torrentSettings'

// Границы — как у DTO сервера: рейтинг 0,1–100, время от часа до десяти лет
const MAX_MINUTES = 3650 * DAY_MINUTES
const NUMBER = /^\d+(?:[.,]\d+)?$/

/** Поля правила раздачи; `withDefault` — у загрузки есть «как в настройках» */
export function seedRuleSchema(
  t: (key: string) => string,
  withDefault: boolean,
) {
  const modes: [string, ...string[]] = withDefault
    ? [DEFAULT_RULE, ...SEED_MODES]
    : [...SEED_MODES]

  return z
    .object({
      mode: z.enum(modes),
      ratio: z.string().trim(),
      amount: z.string().trim(),
      unit: z.enum(['hours', 'days']),
    })
    .superRefine((fields, ctx) => {
      if (fields.mode === 'ratio') {
        const ratio = fieldNumber(fields.ratio)

        if (!NUMBER.test(fields.ratio) || ratio < 0.1 || ratio > 100) {
          ctx.addIssue({
            code: 'custom',
            path: ['ratio'],
            message: t('panel.settings.torrent.validation.ratio'),
          })
        }
      }

      if (fields.mode === 'time') {
        const minutes = seedMinutes(fields.amount, fields.unit)

        if (
          !/^\d+$/.test(fields.amount)
          || minutes < 60
          || minutes > MAX_MINUTES
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['amount'],
            message: t('panel.settings.torrent.validation.time'),
          })
        }
      }
    })
}
