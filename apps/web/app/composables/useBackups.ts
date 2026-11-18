import type {
  BackupDirCheck,
  BackupItem,
  BackupStatus,
  UpdateBackupSettingsInput,
} from '@torsher/api-client'
import type { BackupProblem } from '~/lib/backups'
import { getErrorBody, getErrorStatus } from '@torsher/api-client'
import { useDocumentVisibility } from '@vueuse/core'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

// Снимок и проверка копии перед восстановлением идут на сервере в фоне
const POLL_MS = 1000
// Планировщик и другие клиенты меняют список даже без известной UI операции
const IDLE_POLL_MS = 30_000

/** Отказ сервера с видом причины: показываем его в форме или диалоге */
export class BackupRequestError extends Error {
  readonly status: number
  readonly problem: BackupProblem & { field?: string }

  constructor(status: number, problem: BackupProblem & { field?: string }) {
    super(`Backup request failed: ${problem.kind}`)
    this.name = 'BackupRequestError'
    this.status = status
    this.problem = problem
  }
}

/** Ответ 404/413/422 сервера копий — в `BackupRequestError`, прочее — `unknown` */
export async function toBackupRequestError(err: unknown) {
  if (err instanceof BackupRequestError)
    return err

  const status = getErrorStatus(err) ?? 0
  const body = await getErrorBody<{
    kind?: string
    params?: Record<string, string | number>
    field?: string
  }>(err)

  return new BackupRequestError(status, {
    kind: body?.kind ?? (status === 404 ? 'not_found' : 'unknown'),
    params: body?.params,
    field: body?.field,
  })
}

const status = shallowRef<BackupStatus | null>(null)
const state = ref<LoadState>('idle')
let pollTimer: ReturnType<typeof setTimeout> | undefined
let polling = false
let revision = 0
let reads = 0
let mutating = 0
let mutationQueue: Promise<void> = Promise.resolve()

function needsFastPoll(value: BackupStatus | null) {
  return !!value?.state.running || value?.restore?.state === 'checking'
}

function schedulePoll() {
  clearTimeout(pollTimer)

  if (!polling || mutating > 0)
    return

  pollTimer = setTimeout(
    async () => {
      await refresh()
      schedulePoll()
    },
    needsFastPoll(status.value) ? POLL_MS : IDLE_POLL_MS,
  )
}

function apply(next: BackupStatus) {
  status.value = next
  state.value = 'ready'
  schedulePoll()
}

function fetchStatus() {
  return withErrorMode('silent', () => api.backups.getBackups())
}

async function readStatus(initial: boolean) {
  const started = revision
  const request = ++reads
  if (initial && state.value !== 'ready')
    state.value = 'loading'
  try {
    const next = await fetchStatus()
    if (started !== revision || request !== reads || mutating > 0)
      return
    apply(next)
  }
  catch {
    if (started === revision && request === reads && state.value === 'loading')
      state.value = 'error'
  }
}

function load() {
  return readStatus(true)
}

/** Фоновый ответ, начатый до мутации, не заменяет подтверждённые настройки. */
function refresh() {
  return readStatus(false)
}

function enqueue(action: () => Promise<void>) {
  revision++
  mutating++
  clearTimeout(pollTimer)
  const result = mutationQueue.then(action)
  // Разные карточки страницы не должны перезаписывать ответы друг друга.
  mutationQueue = result.catch(() => {})
  return result.finally(() => {
    revision++
    mutating--
    schedulePoll()
  })
}

function mutate(action: () => Promise<BackupStatus>) {
  return enqueue(async () => apply(await action()))
}

/** Чтение внутри очереди относится к только что подтверждённой операции. */
async function refreshAfterMutation() {
  const next = await fetchStatus().catch(() => null)
  if (next)
    apply(next)
}

/** Расписание; каталог передаёт только диалог каталога */
async function saveSettings(patch: Partial<UpdateBackupSettingsInput>) {
  if (!status.value?.settings)
    return

  try {
    await mutate(() => {
      const current = status.value!.settings
      return withErrorMode('silent', () =>
        api.backups.putBackupSettings({
          enabled: patch.enabled ?? current.enabled,
          time: patch.time ?? current.time,
          keepDaily: patch.keepDaily ?? current.keepDaily,
          keepWeekly: patch.keepWeekly ?? current.keepWeekly,
          ...('dir' in patch ? { dir: patch.dir } : {}),
        }))
    })
  }
  catch (err) {
    throw await toBackupRequestError(err)
  }
}

function checkDir(path: string): Promise<BackupDirCheck> {
  return withErrorMode('silent', () =>
    api.backups.postBackupDirCheck({ path }))
}

async function setPassword(password: string) {
  await mutate(() =>
    api.backups.putBackupEncryption({ mode: 'password', password }),
  )
}

async function removePassword() {
  await mutate(() => api.backups.putBackupEncryption({ mode: 'key' }))
}

/** Ручная копия: сервер снимает её в фоне, итог — по опросу */
async function backupNow() {
  await mutate(() => api.backups.postBackup())
}

function removeBackup(name: string) {
  return enqueue(async () => {
    await api.backups.deleteBackup(name)
    if (status.value) {
      apply({
        ...status.value,
        items: status.value.items.filter(item => item.name !== name),
      })
    }
    await refreshAfterMutation()
  })
}

function sendUpload(file: File) {
  return fetch(`/api/backups/upload?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  })
}

/**
 * Загрузка файла копии потоком: голый `fetch` без таймаута клиента API —
 * гигабайт по медленной сети идёт дольше любого таймаута. Истёкшую сессию
 * обновляет любой запрос клиента API, после чего пробуем ещё раз.
 */
async function uploadFile(file: File): Promise<BackupItem> {
  let response = await sendUpload(file)

  if (response.status === 401) {
    await withErrorMode('silent', () => api.backups.getBackupRestore()).catch(
      () => {},
    )
    response = await sendUpload(file)
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      kind?: string
      params?: Record<string, string | number>
    } | null

    throw new BackupRequestError(response.status, {
      kind: body?.kind ?? 'unknown',
      params: body?.params,
    })
  }

  return (await response.json()) as BackupItem
}

async function upload(file: File) {
  const item = await uploadFile(file)

  await enqueue(refreshAfterMutation)

  return item
}

function dismissRestore() {
  return enqueue(async () => {
    await api.backups.deleteBackupRestore()
    await refreshAfterMutation()
  })
}

export function useBackups() {
  return {
    status: computed(() => status.value),
    state: readonly(state),
    load,
    refresh,
    saveSettings,
    checkDir,
    setPassword,
    removePassword,
    backupNow,
    removeBackup,
    upload,
    uploadFile,
    dismissRestore,
  }
}

/**
 * Опрос на время жизни страницы и только в видимой вкладке: пока идёт
 * снимок или проверка копии — часто, в ожидании — реже. При возврате
 * во вкладку страница сразу получает свежее состояние.
 */
export function useBackupsPolling() {
  const visibility = useDocumentVisibility()
  let disposed = false

  function sync() {
    polling = visibility.value === 'visible'

    if (polling)
      schedulePoll()
    else clearTimeout(pollTimer)
  }

  onMounted(async () => {
    await (status.value ? refresh() : load())
    if (!disposed)
      sync()
  })

  watch(visibility, (value) => {
    if (value === 'visible')
      void refresh()

    sync()
  })

  onBeforeUnmount(() => {
    disposed = true
    polling = false
    clearTimeout(pollTimer)
  })
}
