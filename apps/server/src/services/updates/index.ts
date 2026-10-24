import type { GithubRelease, UpdateErrorKind } from './github.ts'
import type { Version } from './version.ts'
import { config } from '../../config.ts'
import { logFor } from '../logs/index.ts'
import { getSetting, setSetting } from '../settings/index.ts'
import { fetchReleases, githubRepoOf, UpdateCheckError } from './github.ts'
import { releaseHighlights } from './notes.ts'
import { compareVersions, isNewerVersion, parseVersion } from './version.ts'

export { recordServerVersion } from './history.ts'

const SETTINGS_KEY = 'updateCheck'
const STATE_KEY = 'updateState'

const HOUR_MS = 60 * 60 * 1000
const CHECK_INTERVAL_MS = 24 * HOUR_MS
const RETRY_INTERVAL_MS = HOUR_MS
// «Проверить сейчас» чаще не ходит в GitHub: лимит без токена — на весь адрес
const MANUAL_MIN_INTERVAL_MS = 60 * 1000

export const updateChannels = ['stable', 'beta'] as const
export type UpdateChannel = (typeof updateChannels)[number]

export interface UpdateSettings {
  enabled: boolean
  channel: UpdateChannel
}

export interface ReleaseInfo {
  version: string
  publishedAt?: string
  url: string
  notes: string[]
  prerelease: boolean
}

/** Последняя проверка. Время — ISO-строки: значение лежит в JSON */
export interface UpdateState {
  attemptedAt?: string
  // Последний ответ GitHub без ошибки, в том числе 304
  checkedAt?: string
  etag?: string
  // Новейший релиз каждого канала: смена канала не требует запроса
  stable?: ReleaseInfo
  beta?: ReleaseInfo
  error?: { kind: UpdateErrorKind, at: string }
  retryAt?: string
  // О версии сообщили один раз; скрыть карточку можно до следующей версии
  notifiedVersion?: string
  dismissedVersion?: string
}

export function readUpdateSettings(): UpdateSettings {
  const saved = getSetting<Partial<UpdateSettings>>(SETTINGS_KEY)

  return {
    enabled: saved?.enabled ?? true,
    channel: saved?.channel === 'beta' ? 'beta' : 'stable',
  }
}

export function readUpdateState(): UpdateState {
  return getSetting<UpdateState>(STATE_KEY) ?? {}
}

function writeUpdateState(state: UpdateState) {
  setSetting(STATE_KEY, state)
}

// Как обновить контейнер — раздел README репозитория исходников
function docsUrl() {
  return `${config.sourceUrl.replace(/\/+$/, '')}#updating`
}

function sourceRepo() {
  return githubRepoOf(config.sourceUrl)
}

/** Новейший релиз среди не черновиков с тегом-версией; `beta` берёт и пререлизы */
export function latestRelease(
  releases: GithubRelease[],
  includePrerelease: boolean,
): ReleaseInfo | undefined {
  let best: { release: GithubRelease, version: Version } | undefined

  for (const release of releases) {
    const version = parseVersion(release.tagName)

    if (release.draft || !version)
      continue

    const prerelease = release.prerelease || version.prerelease.length > 0

    if (prerelease && !includePrerelease)
      continue

    if (!best || compareVersions(version, best.version) > 0)
      best = { release, version }
  }

  if (!best)
    return undefined

  const { release } = best

  return {
    version: release.tagName.replace(/^v/, ''),
    publishedAt: release.publishedAt,
    url: release.url,
    notes: releaseHighlights(release.body),
    prerelease: release.prerelease || best.version.prerelease.length > 0,
  }
}

/** Новая версия выбранного канала, если она есть */
export function availableUpdate(
  state = readUpdateState(),
  settings = readUpdateSettings(),
) {
  if (!settings.enabled || !config.isRelease)
    return undefined

  const latest = state[settings.channel]

  return latest && isNewerVersion(latest.version, config.version)
    ? latest
    : undefined
}

type UpdateListener = (release: ReleaseInfo) => void

let updateListener: UpdateListener | undefined

/** Новая версия найдена впервые: сообщение о ней уходит один раз */
export function onUpdateFound(listener: UpdateListener) {
  updateListener = listener
}

function announce(state: UpdateState) {
  const update = availableUpdate(state)

  if (!update || state.notifiedVersion === update.version)
    return state

  try {
    updateListener?.(update)
  }
  catch (err) {
    logFor('server').error({ err }, 'Update notification failed')
  }

  return { ...state, notifiedVersion: update.version }
}

let running: Promise<void> | undefined

export function isUpdateCheckRunning() {
  return running !== undefined
}

/** Проверка возможна: включена, сборка — релиз, исходники на GitHub */
function checkAllowed() {
  return (
    readUpdateSettings().enabled
    && config.isRelease
    && sourceRepo() !== undefined
  )
}

type CheckResult = Pick<
  UpdateState,
  'attemptedAt' | 'checkedAt' | 'etag' | 'stable' | 'beta' | 'error' | 'retryAt'
>

/**
 * Итог проверки поверх свежего состояния: пока шёл запрос, владелец мог
 * скрыть карточку, а смена канала — сообщить о версии.
 */
function saveCheckResult(result: CheckResult) {
  const next = announce({ ...readUpdateState(), ...result })

  writeUpdateState(next)

  return next
}

/** Проверка релизов; одновременно идёт одна, повторный вызов ждёт текущую */
export function checkForUpdates(): Promise<void> {
  if (running)
    return running

  const repo = sourceRepo()

  if (!repo || !checkAllowed())
    return Promise.resolve()

  running = (async () => {
    const state = readUpdateState()
    const attemptedAt = new Date().toISOString()

    try {
      const result = await fetchReleases(
        repo,
        state.stable || state.beta ? state.etag : undefined,
      )
      const next = saveCheckResult({
        attemptedAt,
        checkedAt: attemptedAt,
        error: undefined,
        retryAt: undefined,
        ...(result.notModified
          ? {}
          : {
              etag: result.etag,
              stable: latestRelease(result.releases, false),
              beta: latestRelease(result.releases, true),
            }),
      })

      logFor('server').info(
        { stable: next.stable?.version, beta: next.beta?.version },
        'Updates checked',
      )
    }
    catch (err) {
      const kind = err instanceof UpdateCheckError ? err.kind : 'unavailable'
      const retryAt
        = err instanceof UpdateCheckError
          ? err.retryAt?.toISOString()
          : undefined

      saveCheckResult({
        attemptedAt,
        error: { kind, at: attemptedAt },
        retryAt,
      })
      logFor('server').warn({ err }, 'Update check failed')
    }
  })().finally(() => {
    running = undefined
  })

  return running
}

export function isUpdateCheckDue(now = Date.now()) {
  if (!checkAllowed())
    return false

  const state = readUpdateState()

  // После лимита GitHub — сразу после его сброса, без часа ожидания
  if (state.retryAt)
    return Date.parse(state.retryAt) <= now

  if (!state.attemptedAt)
    return true

  // Закрытый или удалённый репозиторий за час не появится: повтор — как обычно
  const retrySoon = state.error && state.error.kind !== 'not_found'
  const since = state.error
    ? Date.parse(state.attemptedAt)
    : Date.parse(state.checkedAt ?? state.attemptedAt)

  return now - since >= (retrySoon ? RETRY_INTERVAL_MS : CHECK_INTERVAL_MS)
}

function startCheck() {
  checkForUpdates().catch(err =>
    logFor('server').error({ err }, 'Update check failed'),
  )
}

/** Проверка при старте и раз в час; сам запрос — раз в сутки или после ошибки */
export function startUpdateSchedule() {
  const tick = () => {
    if (isUpdateCheckDue())
      startCheck()
  }

  tick()
  setInterval(tick, HOUR_MS).unref()
}

/** «Проверить сейчас»: не чаще раза в минуту, лимит GitHub — на весь адрес */
export async function checkForUpdatesNow() {
  if (!checkAllowed())
    return

  const state = readUpdateState()
  const last = state.attemptedAt ? Date.parse(state.attemptedAt) : 0
  const limited = state.retryAt && Date.parse(state.retryAt) > Date.now()

  if (!limited && Date.now() - last >= MANUAL_MIN_INTERVAL_MS)
    await checkForUpdates()
}

export function saveUpdateSettings(settings: UpdateSettings) {
  const previous = readUpdateSettings()

  setSetting(SETTINGS_KEY, settings)

  // Включили проверку — сразу проверяем; сменили канал — сообщаем о версии
  // этого канала, если она новее
  if (settings.enabled && !previous.enabled && isUpdateCheckDue())
    startCheck()
  else writeUpdateState(announce(readUpdateState()))
}

export function dismissUpdate(version: string) {
  writeUpdateState({ ...readUpdateState(), dismissedVersion: version })
}

export type UpdateStatusState
  = | 'off'
    | 'dev'
    | 'unsupported'
    | 'unknown'
    | 'checking'
    | 'current'
    | 'available'
    | 'error'

export function updateStatus() {
  const settings = readUpdateSettings()
  const state = readUpdateState()
  const update = availableUpdate(state, settings)
  const failed
    = state.error
      && (!state.checkedAt
        || Date.parse(state.error.at) >= Date.parse(state.checkedAt))
  let status: UpdateStatusState

  if (!config.isRelease)
    status = 'dev'
  else if (!sourceRepo())
    status = 'unsupported'
  else if (!settings.enabled)
    status = 'off'
  else if (isUpdateCheckRunning())
    status = 'checking'
  else if (update)
    status = 'available'
  else if (failed)
    status = 'error'
  else if (state.checkedAt)
    status = 'current'
  else status = 'unknown'

  return {
    current: { version: config.version, commit: config.commit },
    docsUrl: docsUrl(),
    enabled: settings.enabled,
    channel: settings.channel,
    state: status,
    latest: update,
    checkedAt: state.checkedAt,
    error: failed ? state.error : undefined,
  }
}

/** Карточка «Доступна версия» на «Обзоре», пока её не скрыли */
export function overviewUpdate() {
  const state = readUpdateState()
  const settings = readUpdateSettings()
  const update = availableUpdate(state, settings)

  if (!update || state.dismissedVersion === update.version)
    return undefined

  return {
    version: update.version,
    publishedAt: update.publishedAt,
    url: update.url,
    notes: update.notes.slice(0, 3),
    channel: settings.channel,
    docsUrl: docsUrl(),
  }
}
