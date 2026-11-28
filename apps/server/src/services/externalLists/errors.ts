import type { ExternalListsErrorCode } from '../../dto/externalLists.ts'

const statuses = {
  keyRequired: 409,
  keyRejected: 409,
  sourceUnavailable: 404,
  sourceAmbiguous: 400,
  sourceTooLarge: 422,
  listLimit: 409,
  duplicate: 409,
  retryLater: 429,
  previewExpired: 409,
  invalidSource: 400,
  providerError: 502,
  notFound: 404,
} as const satisfies Record<ExternalListsErrorCode, number>

export class ExternalListsError extends Error {
  readonly code: ExternalListsErrorCode

  constructor(code: ExternalListsErrorCode) {
    super(code)
    this.code = code
  }

  get statusCode() {
    return statuses[this.code]
  }
}

export function listErrorCode(error: unknown): ExternalListsErrorCode {
  return error instanceof ExternalListsError ? error.code : 'providerError'
}
