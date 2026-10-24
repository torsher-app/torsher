import type {
  ApplyServerImport,
  BackupErrorResponse,
  CreateExport,
  ServerImportPreview,
  ServerImportResult,
  TransferErrorResponse,
} from '@torsher/api-client'
import { getErrorBody, getErrorStatus } from '@torsher/api-client'
import { readFileAsBase64 } from '~/lib/torrents'
import { api } from '~/services/api'

// Как у сервера: экспорт сервера за годы просмотров — несколько мегабайт
export const MAX_EXPORT_BYTES = 50 * 1024 * 1024

export type TransferErrorKind = TransferErrorResponse['kind'] | 'unknown'

/** Файл не подошёл для импорта: не экспорт, новее сервера или битый */
export class TransferFileError extends Error {
  kind: TransferErrorKind

  constructor(kind: TransferErrorKind) {
    super(kind)
    this.kind = kind
  }
}

/** Копия перед импортом не снялась: импорт не начался */
export class TransferBackupError extends Error {
  body: BackupErrorResponse | null

  constructor(body: BackupErrorResponse | null) {
    super(body?.kind ?? 'unknown')
    this.body = body
  }
}

function exportFileName(now = new Date()) {
  return `torsher-export-${now.toISOString().slice(0, 10)}.json`
}

/** Экспорт сервера или профиля: файл сразу скачивается браузером */
export async function downloadExport(body: CreateExport) {
  const document = await withErrorMode('silent', () =>
    api.transfer.postTransferExport(body))
  const blob = new Blob([`${JSON.stringify(document, null, 2)}\n`], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const link = window.document.createElement('a')

  link.href = url
  link.download = exportFileName()
  window.document.body.append(link)
  link.click()
  link.remove()
  // Отзыв в том же тике может оборвать скачивание в некоторых браузерах
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function previewTransfer(
  file: File,
  password?: string,
): Promise<ServerImportPreview> {
  if (file.size > MAX_EXPORT_BYTES)
    throw new TransferFileError('tooLarge')

  const data = await readFileAsBase64(file)

  try {
    return await withErrorMode('silent', () =>
      api.transfer.postTransferImportPreview({
        data,
        password: password || undefined,
      }))
  }
  catch (err) {
    if (getErrorStatus(err) === 400) {
      const body = await getErrorBody<TransferErrorResponse>(err)

      throw new TransferFileError(body?.kind ?? 'unknown')
    }

    throw err
  }
}

export async function applyTransfer(
  body: ApplyServerImport,
): Promise<ServerImportResult> {
  try {
    return await withErrorMode('silent', () =>
      api.transfer.postTransferImportApply(body))
  }
  catch (err) {
    if (getErrorStatus(err) === 422) {
      throw new TransferBackupError(
        (await getErrorBody<BackupErrorResponse>(err)) ?? null,
      )
    }

    throw err
  }
}
