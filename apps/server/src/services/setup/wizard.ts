import { getSetting, setSetting } from '../settings/index.ts'

export type WizardStep = 'storage' | 'network' | 'sources' | 'done'

interface StoredWizard {
  step: WizardStep
  skipped: WizardStep[]
  completedAt: string | null
}

export interface WizardState extends StoredWizard {
  active: boolean
}

export const WIZARD_SETTING = 'setupWizard'

/** Состояние нового мастера: его пишет создание аккаунта */
export function startWizard() {
  setSetting(WIZARD_SETTING, {
    step: 'storage',
    skipped: [],
    completedAt: null,
  } satisfies StoredWizard)
}

/**
 * Записи нет у сервера, где аккаунт появился до мастера: такой сервер уже
 * настроен, и обновление не уводит владельца в мастер.
 */
export function getWizard(): WizardState {
  const stored = getSetting<StoredWizard>(WIZARD_SETTING)

  if (!stored) {
    return {
      active: false,
      step: 'storage',
      skipped: [],
      completedAt: null,
    }
  }

  return { ...stored, active: !stored.completedAt }
}

export function updateWizard(values: {
  step: WizardStep
  skipped: WizardStep[]
  completed: boolean
}): WizardState {
  const current = getWizard()
  // Время завершения не сдвигается повторным «Готово»
  const completedAt = values.completed
    ? (current.completedAt ?? new Date().toISOString())
    : null

  setSetting(WIZARD_SETTING, {
    step: values.step,
    skipped: [...new Set(values.skipped)],
    completedAt,
  } satisfies StoredWizard)

  return getWizard()
}
