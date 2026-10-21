import type { Profile } from '@torsher/api-client'

export type ProfileColor = Profile['color']
export type ProfileAgeLimit = NonNullable<Profile['ageLimit']>

// Порядок выбора цвета в диалоге; у сервера тот же набор
export const PROFILE_COLORS: ProfileColor[] = [
  'violet',
  'green',
  'orange',
  'blue',
  'rose',
  'teal',
  'amber',
  'slate',
]

export const PROFILE_AGE_LIMITS: ProfileAgeLimit[] = [6, 12, 16, 18]

// Насыщенные оттенки: белая буква аватара читается в обеих темах
export const profileColorClass: Record<ProfileColor, string> = {
  violet: 'bg-violet-600',
  green: 'bg-emerald-700',
  orange: 'bg-orange-600',
  blue: 'bg-blue-600',
  rose: 'bg-rose-600',
  teal: 'bg-teal-700',
  amber: 'bg-amber-700',
  slate: 'bg-slate-600',
}

/** Первая буква имени для аватара; эмодзи и составные символы не режутся */
export function initialOf(name: string) {
  const [first] = Array.from(name.trim())

  return first ? first.toLocaleUpperCase() : '?'
}

/** Ввод кода с ТВ: регистр, пробелы и дефис не важны, лишнее отбрасывается */
export function normalizePairingCode(input: string) {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6)
}
