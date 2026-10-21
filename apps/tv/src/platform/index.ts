import { resolvePlatform } from '../lib/platform.ts'

export const platform = resolvePlatform(window.location.search)
