<script setup lang="ts">
import type { MetadataKeyCheck, NetHost } from '@torsher/api-client'
import type { CheckStatus, WizardCheck } from '~/lib/wizardChecks'
import { useI18n } from 'vue-i18n'
import { Skeleton } from '@/components/ui/skeleton'
import MetadataKeyCard from '~/components/settings/MetadataKeyCard.vue'
import NetworkDnsCard from '~/components/settings/NetworkDnsCard.vue'
import WizardActions from '~/components/wizard/WizardActions.vue'
import WizardChecks from '~/components/wizard/WizardChecks.vue'
import { hostStatusView } from '~/lib/netStatus'
import { worstStatus } from '~/lib/wizardChecks'

definePageMeta({
  layout: 'wizard',
  wizardStep: 3,
  middleware: ['required-auth', 'wizard'],
})

const { t } = useI18n()
const network = useNetwork()
const metadata = useMetadataSettings()
const text = useNetworkText()

// Каталогу нужны только хосты TMDB; менеджеры и индексаторы — на шаге «Источники»
const TMDB_KINDS: NetHost['kind'][] = ['tmdb', 'tmdb_images']

const keyCheck = shallowRef<MetadataKeyCheck | null>(null)
const isCheckingKey = ref(false)
const isStarting = ref(false)

const TONE_STATUS: Record<
  ReturnType<typeof hostStatusView>['tone'],
  CheckStatus
> = {
  success: 'ok',
  warning: 'warning',
  destructive: 'error',
  info: 'pending',
  muted: 'pending',
}

function fixOf(host: NetHost, spoofed: boolean) {
  if (spoofed || host.status === 'dns' || host.status === 'tls')
    return t('panel.wizard.network.fix.dns')

  if (host.status === 'doh')
    return t('panel.wizard.network.fix.doh')

  if (host.status === 'timeout' || host.status === 'refused')
    return t('panel.wizard.network.fix.blocked')

  return undefined
}

function hostCheck(host: NetHost): WizardCheck {
  const view = hostStatusView(host)
  // Молчащий TMDB — тот же каталог без постеров и названий, что и отказ:
  // на этом шаге это ошибка, а не предупреждение
  const status = view.state === 'timeout' ? 'error' : TONE_STATUS[view.tone]
  const reason = text.reason(host, view)
  const latency
    = host.latencyMs !== null && view.state === 'ok'
      ? t('panel.wizard.network.latency', { ms: host.latencyMs })
      : ''

  return {
    id: host.id,
    status,
    title: `${t(`panel.wizard.network.hosts.${host.kind}`)} · ${text.statusLabel(view)}`,
    text: reason || [host.host, latency].filter(Boolean).join(' · '),
    fix:
      status === 'ok' || status === 'pending'
        ? undefined
        : fixOf(host, view.spoofed),
  }
}

function keyCheckItem(): WizardCheck {
  const source = metadata.settings.value?.tmdb.source
  const result = keyCheck.value

  if (isCheckingKey.value || !result || !source) {
    return {
      id: 'tmdb-key',
      status: 'pending',
      title: t('panel.wizard.network.key.checking'),
    }
  }

  if (result.ok) {
    return {
      id: 'tmdb-key',
      status: 'ok',
      title: t('panel.wizard.network.key.ok'),
      text: t(`panel.wizard.network.key.source.${source}`),
    }
  }

  const kind = result.kind ?? 'rejected'

  return {
    id: 'tmdb-key',
    status: kind === 'unavailable' ? 'warning' : 'error',
    title: t(`panel.wizard.network.key.${kind}`),
    fix: t(`panel.wizard.network.key.${kind}Fix`),
  }
}

const checks = computed<WizardCheck[]>(() => {
  const hosts = (network.check.value?.hosts ?? []).filter(host =>
    TMDB_KINDS.includes(host.kind),
  )

  if (network.state.value === 'error') {
    return [
      {
        id: 'request',
        status: 'error',
        title: t('panel.settings.network.loadError'),
        fix: t('panel.wizard.checks.retryFix'),
      },
    ]
  }

  return [...hosts.map(hostCheck), keyCheckItem()]
})

const isLoading = useHeldLoading(() =>
  [network.state.value, metadata.state.value].some(
    state => state === 'idle' || state === 'loading',
  ),
)

const isRunning = computed(
  () => isStarting.value || network.isChecking.value || isCheckingKey.value,
)

const nextLabel = computed(() =>
  worstStatus(checks.value) === 'error'
    ? t('panel.wizard.network.continueWithout')
    : undefined,
)

async function checkKey() {
  isCheckingKey.value = true

  try {
    keyCheck.value = await withErrorMode('silent', () =>
      metadata.checkTmdbKey())
  }
  catch {
    keyCheck.value = { ok: false, kind: 'unavailable' }
  }
  finally {
    isCheckingKey.value = false
  }
}

/** Ключ проверяется после хостов: без сети он не проверится, и это уже видно выше */
async function runCheck() {
  isStarting.value = true

  let started

  try {
    started = await withErrorMode('silent', () => network.checkAll())
  }
  catch {
    return
  }
  finally {
    isStarting.value = false
  }

  await started.done
  await checkKey()
}

// Сохранённый ключ проверяем сразу: итог шага зависит от него
watch(
  () => metadata.settings.value,
  (settings, previous) => {
    if (previous && settings)
      checkKey()
  },
)

onMounted(async () => {
  await Promise.all([network.load(), metadata.load()])

  if (network.state.value === 'ready')
    await runCheck()
})
onBeforeUnmount(network.stopPolling)
</script>

<template>
  <header>
    <h1 class="text-2xl font-semibold tracking-tight text-balance">
      {{ t("panel.wizard.network.title") }}
    </h1>
    <p class="mt-1.5 max-w-[58ch] text-muted-foreground">
      {{ t("panel.wizard.network.text") }}
    </p>
  </header>

  <WizardChecks
    :title="t('panel.wizard.checks.title')"
    :checks="checks"
    :running="isRunning"
    @retry="runCheck"
  />

  <!-- Настройки — те же карточки, что в «Настройки → Сеть» и «Метаданные» -->
  <div v-if="isLoading" class="grid gap-5" aria-busy="true">
    <Skeleton class="h-40 rounded-xl" />
    <Skeleton class="h-56 rounded-xl" />
  </div>
  <template v-else>
    <NetworkDnsCard
      v-if="network.defaultRoute.value"
      :route="network.defaultRoute.value"
    />
    <MetadataKeyCard
      v-if="metadata.settings.value"
      :settings="metadata.settings.value"
    />
  </template>

  <WizardActions step="network" :next-label="nextLabel" />
</template>
