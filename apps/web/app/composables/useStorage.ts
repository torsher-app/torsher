import type {
  StorageOverview,
  StoragePathCheck,
  UpdateStoragePathInput,
  UpdateStoragePolicyInput,
} from '@torsher/api-client'
import { getErrorBody, getErrorStatus } from '@torsher/api-client'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'
export type StorageKind = UpdateStoragePathInput['kind']
export type StoragePathError
  = NonNullable<StoragePathCheck['problem']> | 'busy' | 'no_space' | 'unknown'

/** Почему папку не сменили: вид из ответа 409 и 422, иначе — общая ошибка */
export async function storagePathError(
  err: unknown,
): Promise<StoragePathError> {
  const status = getErrorStatus(err)

  if (status !== 409 && status !== 422)
    return 'unknown'

  const body = await getErrorBody<{ kind?: StoragePathError }>(err)

  return body?.kind ?? 'unknown'
}

// Пока идёт перенос, прогресс обновляется опросом
const MOVE_POLL_MS = 1500

const overview = shallowRef<StorageOverview | null>(null)
const state = ref<LoadState>('idle')
let pollTimer: ReturnType<typeof setTimeout> | undefined

function schedulePoll() {
  clearTimeout(pollTimer)

  if (overview.value?.move?.status !== 'running')
    return

  pollTimer = setTimeout(async () => {
    try {
      overview.value = await withErrorMode('silent', () =>
        api.storage.getStorage())
    }
    catch {}

    schedulePoll()
  }, MOVE_POLL_MS)
}

function apply(next: StorageOverview) {
  overview.value = next
  schedulePoll()
}

async function load() {
  // Показанное остаётся на экране, пока идёт новый запрос, и ошибка его не прячет
  if (state.value !== 'ready')
    state.value = 'loading'

  try {
    apply(await withErrorMode('silent', () => api.storage.getStorage()))
    state.value = 'ready'
  }
  catch {
    if (state.value === 'loading')
      state.value = 'error'
  }
}

/** Сохраняет политику целиком: карточка меняет одно поле, второе — как сейчас */
async function savePolicy(patch: Partial<UpdateStoragePolicyInput>) {
  const current = overview.value?.policy

  if (!current)
    return

  apply(
    await api.storage.putStoragePolicy({
      cacheLimit: patch.cacheLimit ?? current.cacheLimit,
      minFree: patch.minFree ?? current.minFree,
    }),
  )
}

/** Проверка папки в диалоге выбора: ошибки показывает сам диалог */
function checkPath(kind: StorageKind, path: string): Promise<StoragePathCheck> {
  return withErrorMode('silent', () =>
    api.storage.postStorageCheck({ kind, path }))
}

async function changePath(input: UpdateStoragePathInput) {
  apply(await withErrorMode('silent', () => api.storage.putStoragePath(input)))
}

/** «Перенести сюда»: то, что осталось в прежних папках */
async function moveLeftovers(kind: StorageKind) {
  apply(await api.storage.postStorageMove({ kind }))
}

async function cancelMove() {
  apply(await api.storage.postStorageMoveCancel())
}

export function useStorage() {
  return {
    overview: computed(() => overview.value),
    state: readonly(state),
    load,
    savePolicy,
    checkPath,
    changePath,
    moveLeftovers,
    cancelMove,
  }
}
