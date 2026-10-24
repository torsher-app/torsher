import type {
  AppliedImport,
  ApplyProfileImport,
  ImportFormatErrorResponse,
  ImportJob,
  ImportOverview,
  UndoneImport,
} from '@torsher/api-client'
import type { MaybeRefOrGetter } from 'vue'
import { getErrorBody, getErrorStatus } from '@torsher/api-client'
import { readFileAsBase64 } from '~/lib/torrents'
import { api } from '~/services/api'

type LoadState = 'loading' | 'error' | 'ready'

export type ImportFormatErrorKind = ImportFormatErrorResponse['kind']

/** Ошибка загрузки файлов: что не так с файлом или «не дошло до сервера» */
export class ImportUploadError extends Error {
  kind: ImportFormatErrorKind | 'unknown'
  file?: string

  constructor(kind: ImportFormatErrorKind | 'unknown', file?: string) {
    super(kind)
    this.kind = kind
    this.file = file
  }
}

// Пока сервер сопоставляет, обзор и задача опрашиваются
const POLL_MS = 1500

/**
 * Импорт оценок профиля: обзор для карточки (идущая задача, последний
 * импорт, несопоставленное) и действия. Пока идёт сопоставление, обзор
 * обновляется сам.
 */
export function useProfileImports(
  profileId: MaybeRefOrGetter<string | undefined>,
) {
  const overview = shallowRef<ImportOverview | null>(null)
  const state = ref<LoadState>('loading')
  let timer: ReturnType<typeof setTimeout> | undefined
  let token = 0

  async function load() {
    const id = toValue(profileId)

    clearTimeout(timer)

    if (!id)
      return

    const mine = ++token

    if (!overview.value)
      state.value = 'loading'

    try {
      const res = await withErrorMode('silent', () =>
        api.profiles.getProfileImports(id))

      if (mine !== token)
        return

      overview.value = res
      state.value = 'ready'

      if (res.job?.state === 'matching')
        timer = setTimeout(load, POLL_MS)
    }
    catch {
      if (mine === token && !overview.value)
        state.value = 'error'
    }
  }

  watch(
    () => toValue(profileId),
    () => {
      overview.value = null
      void load()
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    token++
    clearTimeout(timer)
  })

  return { overview, state, load }
}

export async function uploadImportFiles(
  profileId: string,
  files: File[],
): Promise<ImportJob> {
  const payload = await Promise.all(
    files.map(async file => ({
      name: file.name,
      data: await readFileAsBase64(file),
    })),
  )

  try {
    return await withErrorMode('silent', () =>
      api.profiles.postProfileImport(profileId, { files: payload }))
  }
  catch (err) {
    if (getErrorStatus(err) === 400) {
      const body = await getErrorBody<ImportFormatErrorResponse>(err)

      if (body?.kind)
        throw new ImportUploadError(body.kind, body.file)
    }

    throw new ImportUploadError('unknown')
  }
}

export function fetchImportJob(profileId: string, importId: string) {
  return withErrorMode('silent', () =>
    api.profiles.getProfileImport(profileId, importId))
}

export function cancelImportJob(profileId: string, importId: string) {
  return withErrorMode('silent', () =>
    api.profiles.deleteProfileImport(profileId, importId))
}

export function applyImportJob(
  profileId: string,
  importId: string,
  conflicts: ApplyProfileImport['conflicts'],
): Promise<AppliedImport> {
  return withErrorMode('silent', () =>
    api.profiles.postProfileImportApply(profileId, importId, { conflicts }))
}

export function undoImportRun(
  profileId: string,
  importId: string,
): Promise<UndoneImport> {
  return withErrorMode('silent', () =>
    api.profiles.postProfileImportUndo(profileId, importId))
}

export const IMPORT_POLL_MS = POLL_MS
