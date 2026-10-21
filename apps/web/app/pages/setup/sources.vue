<script setup lang="ts">
import type { DiscoveredManager } from '@torsher/api-client'
import type { WizardCheck } from '~/lib/wizardChecks'
import { useI18n } from 'vue-i18n'
import { Skeleton } from '@/components/ui/skeleton'
import ImportManagerDialog from '~/components/sources/ImportManagerDialog.vue'
import ConnectManagerCard from '~/components/wizard/ConnectManagerCard.vue'
import NoManagersCard from '~/components/wizard/NoManagersCard.vue'
import WizardActions from '~/components/wizard/WizardActions.vue'
import WizardChecks from '~/components/wizard/WizardChecks.vue'

definePageMeta({
  layout: 'wizard',
  wizardStep: 4,
  middleware: ['required-auth', 'wizard'],
})

const { t } = useI18n()
const { discoverManagers } = useWizard()
const sources = useSources()

const found = shallowRef<DiscoveredManager[] | null>(null)
const isDiscovering = ref(false)
const isImportOpen = ref(false)

function isConnected(item: DiscoveredManager) {
  return sources.managers.value.some(
    manager => manager.kind === item.kind && manager.url === item.url,
  )
}

const notConnected = computed(() =>
  (found.value ?? []).filter(item => !isConnected(item)),
)

const discoveryChecks = computed<WizardCheck[]>(() => {
  if (isDiscovering.value || !found.value) {
    return [
      {
        id: 'discover',
        status: 'pending',
        title: t('panel.wizard.sources.discovering'),
      },
    ]
  }

  if (found.value.length === 0) {
    return [
      {
        id: 'discover',
        status: 'warning',
        title: t('panel.wizard.sources.notFound'),
        text: t('panel.wizard.sources.notFoundText'),
        fix: t('panel.wizard.sources.notFoundFix'),
      },
    ]
  }

  return found.value.map(item => ({
    id: item.url,
    status: 'ok',
    title: t(
      isConnected(item)
        ? 'panel.wizard.sources.connected'
        : 'panel.wizard.sources.foundManager',
      { manager: t(`panel.kinds.${item.kind}`) },
    ),
    text: item.url,
    mono: true,
  }))
})

const hasIndexers = computed(() => sources.indexers.value.length > 0)

const checks = computed<WizardCheck[]>(() => {
  const indexers: WizardCheck
    = sources.state.value !== 'ready'
      ? {
          id: 'indexers',
          status: sources.state.value === 'error' ? 'error' : 'pending',
          title: t(
            sources.state.value === 'error'
              ? 'panel.wizard.sources.loadError'
              : 'panel.wizard.sources.loading',
          ),
        }
      : hasIndexers.value
        ? {
            id: 'indexers',
            status: 'ok',
            title: t(
              'panel.wizard.sources.indexers',
              sources.indexers.value.length,
            ),
          }
        : {
            id: 'indexers',
            status: 'warning',
            title: t('panel.wizard.sources.noIndexers'),
            text: t('panel.wizard.sources.noIndexersText'),
          }

  return [...discoveryChecks.value, indexers]
})

const nextLabel = computed(() =>
  sources.state.value === 'ready' && !hasIndexers.value
    ? t('panel.wizard.sources.continueWithout')
    : undefined,
)

async function discover() {
  isDiscovering.value = true

  try {
    found.value = (await discoverManagers()).items
  }
  catch {
    found.value = []
  }
  finally {
    isDiscovering.value = false
  }
}

function retry() {
  sources.load()
  discover()
}

onMounted(retry)
onBeforeUnmount(sources.stopPolling)
</script>

<template>
  <header>
    <h1 class="text-2xl font-semibold tracking-tight text-balance">
      {{ t("panel.wizard.sources.title") }}
    </h1>
    <p class="mt-1.5 max-w-[58ch] text-muted-foreground">
      {{ t("panel.wizard.sources.text") }}
    </p>
  </header>

  <WizardChecks
    :title="t('panel.wizard.checks.title')"
    :checks="checks"
    :running="isDiscovering"
    @retry="retry"
  />

  <Skeleton v-if="isDiscovering || !found" class="h-64 rounded-xl" />
  <ConnectManagerCard
    v-else-if="notConnected.length > 0"
    :key="notConnected.map((item) => item.url).join()"
    :found="notConnected"
  />
  <NoManagersCard
    v-else-if="found.length === 0"
    @import="isImportOpen = true"
  />

  <p class="text-[12.5px] text-muted-foreground">
    {{ t("panel.sources.empty.foot") }}
  </p>

  <WizardActions step="sources" :next-label="nextLabel" />

  <ImportManagerDialog v-model:open="isImportOpen" />
</template>
