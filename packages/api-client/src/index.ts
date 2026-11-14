export {
  correlationHeaders,
  createApiClient,
  getErrorBody,
  getErrorMessage,
  getErrorOutcome,
  getErrorRequestId,
  getErrorStatus,
} from './client'
export type {
  ApiClientOptions,
  ApiRequestContext,
  ApiRequestObservation,
  ErrorMode,
} from './client'
export { createErrorModeStack } from './errorMode'
export type { ErrorModeStack } from './errorMode'
export * from './generated'

export {
  createInternetSpeedtest,
  createLocalSpeedtest,
  readLocalSpeedtest,
  speedtestSupported,
} from './speedtest'
export type {
  InternetSpeedtestState,
  LocalMeasurement,
  LocalSpeedtestState,
} from './speedtest'
