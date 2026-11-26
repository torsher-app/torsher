export class UsenetError extends Error {
  readonly kind: UsenetProblem

  constructor(kind: UsenetProblem) {
    super(kind)
    this.name = 'UsenetError'
    this.kind = kind
  }
}

export type UsenetConnection
  = | 'ok'
    | 'invalid'
    | 'auth'
    | 'unavailable'
    | 'category'
    | 'needs_confirmation'
    | 'address_changed'
    | 'unsupported_version'

export type UsenetProblem
  = | Exclude<UsenetConnection, 'ok'>
    | 'path_unreadable'
    | 'not_ready'
    | 'not_found'
    | 'target_busy'
    | 'interrupted'
    | 'source_unavailable'
    | 'submit_uncertain'
    | 'job_missing'
    | 'client_changed'
    | 'release_failed'
    | 'download_failed'
    | 'output_invalid'
    | 'import_failed'
    | 'import_conflict'
    | 'insufficient_space'
    | 'review_required'
