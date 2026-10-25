export {
  LOADER_DELAY_MS,
  LOADER_MIN_VISIBLE_MS,
  loaderHoldMs,
} from '@torsher/tokens/loader'

/**
 * Торшер на сцене плеера держится дольше: после него экран растворяется в
 * видео, и короткий показ читается как сбой, а не как подготовка
 */
export const STAGE_MIN_VISIBLE_MS = 800
