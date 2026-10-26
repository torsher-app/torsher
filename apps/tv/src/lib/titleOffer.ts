import type { DownloadSlot } from './downloadSlot.ts'

export interface TitleOfferInput {
  // false — на сервере нет источников раздач; undefined — ещё неизвестно
  hasSources: boolean | undefined
  // У тайтла есть файлы в библиотеке
  inLibrary: boolean
  // Есть что продолжить: прогресс ведёт в известную раздачу или к серии
  resume: boolean
  // Профиль следит за тайтлом
  followed: boolean
  slot: DownloadSlot['kind']
}

/**
 * Какие кнопки карточки ведут к поиску раздач и остаются ли они. С
 * источниками — все, как раньше (свои условия у каждой кнопки свои). Без них
 * тайтл не из библиотеки — как в медиатеке: смотреть, качать и «Следить» нечем.
 * Начатое остаётся: «Продолжить», идущая закачка, подписка «Следить» — их
 * можно досмотреть, открыть, отменить.
 */
export function titleOffer(input: TitleOfferInput) {
  if (input.hasSources !== false) {
    return {
      watch: true,
      download: true,
      follow: true,
      sources: true,
      otherRelease: true,
    }
  }

  return {
    watch: input.inLibrary || input.resume,
    download: input.slot === 'active',
    follow: input.followed,
    sources: false,
    otherRelease: false,
  }
}
