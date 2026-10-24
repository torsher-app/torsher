import type { SeedRule } from '@torsher/api-client'

// Как у `formatBytes`: мегабайт — 1024², скорость в «Загрузках» в тех же единицах
const MB = 1024 ** 2

export const MAX_SPEED_MB = 9000

/** Байт/с → поле «МБ/с»; без лимита — пустое поле */
export function speedField(bytes: number, locale: string) {
  if (bytes <= 0)
    return ''

  return new Intl.NumberFormat(locale.replace('_', '-'), {
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(bytes / MB)
}

/** Поле «МБ/с» → байт/с; пустое — 0, без лимита */
export function speedBytes(value: string) {
  const trimmed = value.trim()

  return trimmed ? Math.round(fieldNumber(trimmed) * MB) : 0
}

export const DAY_MINUTES = 24 * 60

export type SeedTimeUnit = 'hours' | 'days'

/** Минуты правила — число и единица поля: целые дни показываем днями */
export function seedTimeField(minutes: number | undefined) {
  if (!minutes)
    return { amount: '', unit: 'days' as SeedTimeUnit }

  return minutes % DAY_MINUTES === 0
    ? { amount: String(minutes / DAY_MINUTES), unit: 'days' as SeedTimeUnit }
    : {
        amount: String(Math.round(minutes / 60)),
        unit: 'hours' as SeedTimeUnit,
      }
}

export function seedMinutes(amount: string, unit: SeedTimeUnit) {
  return Number(amount) * (unit === 'days' ? DAY_MINUTES : 60)
}

/** Правило из полей формы: лишние числа на сервер не уходят */
export function seedRuleOf(fields: {
  mode: SeedRule['mode']
  ratio: string
  amount: string
  unit: SeedTimeUnit
}): SeedRule {
  if (fields.mode === 'ratio')
    return { mode: 'ratio', ratio: fieldNumber(fields.ratio) }

  if (fields.mode === 'time')
    return { mode: 'time', minutes: seedMinutes(fields.amount, fields.unit) }

  return { mode: fields.mode }
}

/** Число из поля: запятая — как точка */
export function fieldNumber(value: string) {
  return Number(value.trim().replace(',', '.'))
}

export const SEED_MODES = ['always', 'ratio', 'time', 'never'] as const

/** «Как в настройках» у отдельной загрузки: `Select` не принимает пустую строку */
export const DEFAULT_RULE = 'default'

/** Поля правила раздачи из сохранённого; без правила — «как в настройках» */
export function seedRuleFields(rule: SeedRule | null) {
  const time = seedTimeField(rule?.minutes)

  return {
    mode: (rule?.mode ?? DEFAULT_RULE) as
      SeedRule['mode'] | typeof DEFAULT_RULE,
    ratio: rule?.ratio === undefined ? '' : String(rule.ratio),
    amount: time.amount,
    unit: time.unit,
  }
}
