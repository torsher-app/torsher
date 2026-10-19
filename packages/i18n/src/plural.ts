import type { Language } from './language.ts'

/** Индекс формы для строки вида `один | несколько | много`. */
export type PluralRule = (choice: number, choicesLength: number) => number

// Три формы: 1, 21 — «сезон»; 2–4, 22–24 — «сезона»; 0, 5–20, 25 — «сезонов»
function russian(choice: number, choicesLength: number) {
  const mod100 = Math.abs(choice) % 100
  const mod10 = mod100 % 10
  let form = 2

  if (mod10 === 1 && mod100 !== 11)
    form = 0
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
    form = 1

  return Math.min(form, choicesLength - 1)
}

/** Правила для языков, которым не хватает английских двух форм. */
export const pluralRules: Partial<Record<Language, PluralRule>> = {
  ru_RU: russian,
}
