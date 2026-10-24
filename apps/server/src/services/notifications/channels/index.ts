import type { ChannelProvider } from './types.ts'
import { apprise } from './apprise.ts'
import { email } from './email.ts'
import { gotify } from './gotify.ts'
import { ntfy } from './ntfy.ts'
import { telegram } from './telegram.ts'
import { webhook } from './webhook.ts'

export { DeliveryError } from './types.ts'
export type { DeliveryErrorKind } from './types.ts'

export type AnyChannelProvider = ChannelProvider<any>

const providers: Record<string, AnyChannelProvider> = {
  telegram,
  webhook,
  ntfy,
  gotify,
  apprise,
  email,
}

export function providerOf(kind: string): AnyChannelProvider | undefined {
  return providers[kind]
}

/** Виды каналов этой сборки */
export function channelKinds() {
  return Object.keys(providers)
}

export function registerProvider(provider: AnyChannelProvider) {
  providers[provider.kind] = provider
}
