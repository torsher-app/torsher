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

function needsPoll(value: BackupStatus | null) {
  return !!value?.state.running || value?.restore?.state === 'checking'
}

function schedulePoll() {
  clearTimeout(pollTimer)

  if (!polling || !needsPoll(status.value))
    return

  pollTimer = setTimeout(async () => {
    await refresh()
    schedulePoll()
  }, POLL_MS)
}

function apply(next: BackupStatus) {
  status.value = next
  schedulePoll()
}

async function load() {
  // Показанное остаётся на экране, пока идёт новый запрос, и ошибка его не прячет
  if (state.value !== 'ready')
    state.value = 'loading'

  try {
    apply(await withErrorMode('silent', () => api.backups.getBackups()))
    state.value = 'ready'
  }
  catch {
    if (state.value === 'loading')
      state.value = 'error'
  }
}

/** Фоновое обновление: ошибка не прячет прошлое состояние */
async function refresh() {
  try {
    apply(await withErrorMode('silent', () => api.backups.getBackups()))
    state.value = 'ready'
  }
  catch {}
}

/** Расписание; каталог передаёт только диалог каталога */
async function saveSettings(patch: Partial<UpdateBackupSettingsInput>) {
  const current = status.value?.settings

  if (!current)
    return

  try {
    apply(
      await withErrorMode('silent', () =>
        api.backups.putBackupSettings({
          enabled: patch.enabled ?? current.enabled,
          time: patch.time ?? current.time,
          keepDaily: patch.keepDaily ?? current.keepDaily,
          keepWeekly: patch.keepWeekly ?? current.keepWeekly,
          ...('dir' in patch ? { dir: patch.dir } : {}),
        })),
    )
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
  apply(await api.backups.putBackupEncryption({ mode: 'password', password }))
}

async function removePassword() {
  apply(await api.backups.putBackupEncryption({ mode: 'key' }))
}

/** Ручная копия: сервер снимает её в фоне, итог — по опросу */
async function backupNow() {
  apply(await api.backups.postBackup())
}

async function removeBackup(name: string) {
  await api.backups.deleteBackup(name)
  await refresh()
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

  await refresh()

  return item
}

async function dismissRestore() {
  await api.backups.deleteBackupRestore()
  await refresh()
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
 * снимок или проверка копии. Вернувшись во вкладку, страница сразу
 * получает свежее состояние.
 */
export function useBackupsPolling() {
  const visibility = useDocumentVisibility()

  function sync() {
    polling = visibility.value === 'visible'

    if (polling)
      schedulePoll()
    else clearTimeout(pollTimer)
  }

  onMounted(async () => {
    await (status.value ? refresh() : load())
    sync()
  })

  watch(visibility, (value) => {
    if (value === 'visible')
      void refresh()

    sync()
  })

  onBeforeUnmount(() => {
    polling = false
    clearTimeout(pollTimer)
  })
}
