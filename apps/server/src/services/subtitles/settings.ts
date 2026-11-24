import type {
  SubtitleProvider,
  SubtitleProviderStatus,
  SubtitleSettingsPatch,
} from '../../dto/subtitles.ts'
import type { SubtitleLanguage } from './languages.ts'
import { randomUUID } from 'node:crypto'
import { decryptSecret, encryptSecret } from '../secrets/index.ts'
import { getSetting, setSetting } from '../settings/index.ts'
import { subtitleLanguages } from './languages.ts'

export const SUBTITLE_SETTINGS_KEY = 'subtitles.providers'

interface OpenSubtitlesConfig {
  revision?: string
  apiKey?: string
  username?: string
  password?: string
  deviceSearch: boolean
  autoDownload: boolean
  languages: SubtitleLanguage[]
}

interface SubdlConfig {
  revision?: string
  apiKey?: string
}

export interface SubtitleConfig {
  openSubtitles: OpenSubtitlesConfig
  subdl: SubdlConfig
}

export interface ProviderCredentials {
  revision: string
  apiKey: string
  username?: string
  password?: string
}

const connections = new Map<
  SubtitleProvider,
  { revision: string, status: SubtitleProviderStatus }
>()
const emptyOpenSubtitles: OpenSubtitlesConfig = {
  deviceSearch: false,
  autoDownload: false,
  languages: [],
}

export function getSubtitleConfig(): SubtitleConfig {
  const stored = getSetting<SubtitleConfig>(SUBTITLE_SETTINGS_KEY)
  return stored ?? { openSubtitles: emptyOpenSubtitles, subdl: {} }
}

export function providerRevision(
  config: SubtitleConfig,
  provider: SubtitleProvider,
) {
  return provider === 'subdl'
    ? config.subdl.revision
    : config.openSubtitles.revision
}

export function openSubtitlesConfigured(config: SubtitleConfig) {
  const open = config.openSubtitles
  return !!(open.apiKey && open.username && open.password && open.revision)
}

export function providersForViewer(
  config: SubtitleConfig,
  owner: boolean,
): SubtitleProvider[] {
  return [
    ...(openSubtitlesConfigured(config)
      && (owner || config.openSubtitles.deviceSearch)
      ? ['opensubtitles' as const]
      : []),
    ...(owner && config.subdl.apiKey && config.subdl.revision
      ? ['subdl' as const]
      : []),
  ]
}

export function subtitleCredentials(
  config: SubtitleConfig,
  provider: SubtitleProvider,
): ProviderCredentials | undefined {
  const entry = provider === 'subdl' ? config.subdl : config.openSubtitles
  if (!entry.revision || !entry.apiKey)
    return undefined
  const open = provider === 'opensubtitles' ? config.openSubtitles : undefined
  if (open && !openSubtitlesConfigured(config))
    return undefined
  return {
    revision: entry.revision,
    apiKey: decryptSecret(entry.apiKey),
    username: open?.username ? decryptSecret(open.username) : undefined,
    password: open?.password ? decryptSecret(open.password) : undefined,
  }
}

const SUBTITLE_ERRORS = {
  ready: { kind: 'ready' },
  auth: { kind: 'auth' },
  unavailable: { kind: 'unavailable' },
  quota: { kind: 'quota' },
} as const

export function connectionStatus(
  provider: SubtitleProvider,
  revision: string | undefined,
): SubtitleProviderStatus | undefined {
  const result = connections.get(provider)
  return result?.revision === revision ? result?.status : undefined
}

export function updateConnection(
  provider: SubtitleProvider,
  revision: string | undefined,
  status: SubtitleProviderStatus,
) {
  if (revision)
    connections.set(provider, { revision, status })
  return status
}

export function unknownConnection(kind: keyof typeof SUBTITLE_ERRORS) {
  return SUBTITLE_ERRORS[kind]
}

export function subtitleSettingsView() {
  const config = getSubtitleConfig()
  return {
    languages: [...subtitleLanguages],
    openSubtitles: {
      configured: openSubtitlesConfigured(config),
      deviceSearch: config.openSubtitles.deviceSearch,
      autoDownload: config.openSubtitles.autoDownload,
      languages: config.openSubtitles.languages,
      connection: connectionStatus(
        'opensubtitles',
        config.openSubtitles.revision,
      ),
    },
    subdl: {
      configured: !!config.subdl.apiKey && !!config.subdl.revision,
      connection: connectionStatus('subdl', config.subdl.revision),
    },
  }
}

export function updateSubtitleConfig(patch: SubtitleSettingsPatch) {
  const config = getSubtitleConfig()
  const open = patch.openSubtitles
  const sub = patch.subdl
  if (open) {
    const previous = config.openSubtitles
    config.openSubtitles = open.disconnect
      ? { ...emptyOpenSubtitles, languages: previous.languages }
      : {
          revision: randomUUID(),
          apiKey: open.apiKey ? encryptSecret(open.apiKey) : previous.apiKey,
          username: open.username
            ? encryptSecret(open.username)
            : previous.username,
          password: open.password
            ? encryptSecret(open.password)
            : previous.password,
          deviceSearch: open.deviceSearch ?? previous.deviceSearch,
          autoDownload: open.autoDownload ?? previous.autoDownload,
          languages: open.languages
            ? [...new Set(open.languages)]
            : previous.languages,
        }
    if (!openSubtitlesConfigured(config)) {
      config.openSubtitles.deviceSearch = false
      config.openSubtitles.autoDownload = false
    }
    connections.delete('opensubtitles')
  }
  if (sub?.disconnect || sub?.apiKey) {
    config.subdl = sub.disconnect
      ? {}
      : {
          revision: randomUUID(),
          apiKey: encryptSecret(sub.apiKey!),
        }
    connections.delete('subdl')
  }
  setSetting(SUBTITLE_SETTINGS_KEY, config)
  return subtitleSettingsView()
}
