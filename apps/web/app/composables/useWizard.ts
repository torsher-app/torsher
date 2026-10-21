import type { WizardState } from '@torsher/api-client'
import { api } from '~/services/api'

export type WizardStep = WizardState['step']

/** Шаги после аккаунта по порядку: номер в оболочке мастера — индекс + 2 */
export const WIZARD_STEPS: WizardStep[] = [
  'storage',
  'network',
  'sources',
  'done',
]

export function wizardPath(step: WizardStep) {
  return `/setup/${step}`
}

// null — ещё не спрашивали сервер
const wizard = shallowRef<WizardState | null>(null)

/** Состояние мастера; сервер не ответил — мастер не навязываем */
async function load() {
  if (!wizard.value) {
    try {
      wizard.value = await withErrorMode('silent', () =>
        api.setup.getSetupWizard())
    }
    catch {
      return null
    }
  }

  return wizard.value
}

async function save(
  patch: Partial<Pick<WizardState, 'step' | 'skipped'>> & {
    completed?: boolean
  },
) {
  const current = await load()

  wizard.value = await api.setup.putSetupWizard({
    step: patch.step ?? current?.step ?? 'storage',
    skipped: patch.skipped ?? current?.skipped ?? [],
    completed: patch.completed ?? Boolean(current?.completedAt),
  })

  return wizard.value
}

function nextOf(step: WizardStep) {
  return WIZARD_STEPS[WIZARD_STEPS.indexOf(step) + 1] ?? 'done'
}

/**
 * «Дальше» и «Пропустить» запоминают следующий шаг: вернувшийся владелец
 * продолжит с него. Пропущенный шаг «Готово» покажет со ссылкой в раздел.
 */
async function leave(step: WizardStep, skipped: boolean) {
  const current = (await load())?.skipped ?? []
  const next = nextOf(step)

  await save({
    step: next,
    skipped: skipped
      ? [...new Set([...current, step])]
      : current.filter(item => item !== step),
  })
  await navigateTo(wizardPath(next))
}

/** «Готово» открыто: мастер завершён, панель в него больше не ведёт */
function finish() {
  return save({ step: 'done', completed: true })
}

/** «Настроить позже»: оставшиеся шаги пропущены, мастер завершён */
async function skipAll(from: WizardStep) {
  const current = (await load())?.skipped ?? []
  const rest = WIZARD_STEPS.slice(WIZARD_STEPS.indexOf(from)).filter(
    step => step !== 'done',
  )

  await save({
    step: 'done',
    skipped: [...new Set([...current, ...rest])],
    completed: true,
  })
  await navigateTo('/')
}

function reset() {
  wizard.value = null
}

export function useWizard() {
  return {
    wizard: computed(() => wizard.value),
    load,
    next: (step: WizardStep) => leave(step, false),
    skip: (step: WizardStep) => leave(step, true),
    finish,
    skipAll,
    reset,
    checkStorage: () =>
      withErrorMode('silent', () => api.setup.getSetupStorageCheck()),
    discoverManagers: () =>
      withErrorMode('silent', () => api.setup.postSetupDiscoverManagers()),
  }
}
