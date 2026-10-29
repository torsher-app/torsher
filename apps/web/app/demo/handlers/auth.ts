import type {
  AboutResponse,
  ChangePasswordInput,
  ChangeUsernameInput,
  DismissUpdateBodyInput,
  MeResponse,
  MessageResponse,
  OverviewResponse,
  SetupResponse,
  SigninInput,
  SignupInput,
  UpdateSettingsBodyInput,
  UpdateStatusResponse,
  UpdateWizardInput,
  WizardState,
} from '@torsher/api-client'
import { DemoError, get, NO_CONTENT, post, put } from '@torsher/demo/router'
import { ago, DAY, DEMO_VERSION, HOUR, isFresh } from '@torsher/demo/state'
import { isImdbEnabled } from './settings'

/** Запуск сервера для «Обзора»: живая установка работает несколько дней */
export const serverStartedAt = ago(isFresh ? 40 : 3 * DAY + 5 * HOUR)

// Аккаунт на сервере один. В `fresh` его ещё нет: панель ведёт на создание
let account: MeResponse | null = isFresh
  ? null
  : {
      id: 'user-owner',
      username: 'Alex',
      createdAt: ago(140 * DAY),
    }

// Живое демо открывается сразу вошедшим, без формы входа
let hasSession = !isFresh

/** Владелец сессии: без неё — 401, как у сервера (ядро клиента уведёт на вход) */
export function requireSession(): MeResponse {
  if (!hasSession || !account)
    throw new DemoError(401, { message: 'Unauthorized' })

  return account
}

/** Имя владельца для профиля по умолчанию, который сервер создаёт сам */
export function ownerName() {
  return account?.username ?? 'Profile'
}

get<SetupResponse>('/api/auth/setup', () => ({ needsSetup: !account }))

post<MessageResponse, SignupInput>('/api/auth/signup', ({ body }) => {
  if (account)
    throw new DemoError(403, { message: 'Registration is closed' })

  account = {
    id: 'user-owner',
    username: body.username.trim(),
    createdAt: new Date().toISOString(),
  }
  startWizard()

  return { message: 'User created' }
})

// Вход принимает любые имя и пароль: об этом говорит плашка демо
post<MessageResponse, SigninInput>('/api/auth/signin', () => {
  if (!account)
    throw new DemoError(400, { message: 'Invalid username or password' })

  hasSession = true

  return { message: 'Signed in' }
})

post<MessageResponse>('/api/auth/refresh', () => {
  if (!hasSession)
    throw new DemoError(401, { message: 'Invalid token' })

  return { message: 'Refreshed' }
})

post<MessageResponse>('/api/auth/logout', () => {
  hasSession = false

  return { message: 'Signed out' }
})

get<MeResponse>('/api/users/me', () => requireSession())

// Пароль в демо не хранится: смена принимается при любом текущем
put<MessageResponse, ChangePasswordInput>('/api/users/me/password', () => {
  requireSession()

  return { message: 'Password changed' }
})

put<MeResponse, ChangeUsernameInput>('/api/users/me/username', ({ body }) => {
  const me = requireSession()

  account = { ...me, username: body.username.trim() }

  return account
})

// Мастер первого запуска. Записи нет — сервер уже настроен до мастера
interface StoredWizard {
  step: WizardState['step']
  skipped: WizardState['skipped']
  completedAt: string | null
}

let wizard: StoredWizard | null = isFresh
  ? null
  : {
      step: 'done',
      skipped: [],
      completedAt: ago(140 * DAY),
    }

/** Новый мастер пишет создание аккаунта */
function startWizard() {
  wizard = { step: 'storage', skipped: [], completedAt: null }
}

function wizardState(): WizardState {
  if (!wizard) {
    return {
      active: false,
      step: 'storage',
      skipped: [],
      completedAt: null,
    }
  }

  return { ...wizard, active: !wizard.completedAt }
}

get<WizardState>('/api/setup/wizard', () => {
  requireSession()

  return wizardState()
})

put<WizardState, UpdateWizardInput>('/api/setup/wizard', ({ body }) => {
  requireSession()

  // Время завершения не сдвигается повторным «Готово»
  const completedAt = body.completed
    ? (wizard?.completedAt ?? new Date().toISOString())
    : null

  wizard = {
    step: body.step,
    skipped: [...new Set(body.skipped)],
    completedAt,
  }

  return wizardState()
})

get<AboutResponse>('/api/about', () => ({
  version: DEMO_VERSION,
  license: 'AGPL-3.0-only',
  sourceUrl: 'https://github.com/torsher-app/torsher',
  imdbAttribution: isImdbEnabled(),
}))

// Обновления: демо собрано из последней версии, новых нет
const UPDATE_DOCS_URL = 'https://torsher.app/docs/maintain/update'

const updates = {
  enabled: true,
  channel: 'stable' as UpdateStatusResponse['channel'],
  checkedAt: ago(isFresh ? 30 : 5 * HOUR),
}

function updateStatus(): UpdateStatusResponse {
  return {
    current: { version: DEMO_VERSION },
    docsUrl: UPDATE_DOCS_URL,
    enabled: updates.enabled,
    channel: updates.channel,
    state: updates.enabled ? 'current' : 'off',
    checkedAt: updates.checkedAt,
  }
}

/** Карточки «Доступна версия» на «Обзоре» нет: демо — последняя версия */
export function overviewUpdate(): OverviewResponse['update'] {
  return undefined
}

get<UpdateStatusResponse>('/api/updates', () => {
  requireSession()

  return updateStatus()
})

put<UpdateStatusResponse, UpdateSettingsBodyInput>(
  '/api/updates/settings',
  ({ body }) => {
    requireSession()

    updates.enabled = body.enabled
    updates.channel = body.channel

    return updateStatus()
  },
)

post<UpdateStatusResponse>('/api/updates/check', () => {
  requireSession()

  updates.checkedAt = new Date().toISOString()

  return updateStatus()
})

post<null, DismissUpdateBodyInput>('/api/updates/dismiss', () => {
  requireSession()

  return NO_CONTENT
})
