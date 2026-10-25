<script setup lang="ts">
import type { StorageCheck, StorageDirCheck } from '@torsher/api-client'
import type { WizardCheck } from '~/lib/wizardChecks'
import { useI18n } from 'vue-i18n'
import { Skeleton } from '@/components/ui/skeleton'
import StorageFoldersCard from '~/components/settings/StorageFoldersCard.vue'
import StoragePolicyCards from '~/components/settings/StoragePolicyCards.vue'
import WizardActions from '~/components/wizard/WizardActions.vue'
import WizardChecks from '~/components/wizard/WizardChecks.vue'
import { formatBytes } from '~/lib/format'
import { worstStatus } from '~/lib/wizardChecks'

definePageMeta({
  layout: 'wizard',
  wizardStep: 2,
  middleware: ['required-auth', 'wizard'],
})

const { t, locale } = useI18n()
const { checkStorage } = useWizard()
const storage = useStorage()
const loading = useHeldLoading(
  () => storage.state.value === 'loading' || storage.state.value === 'idle',
)

const result = shallowRef<StorageCheck | null>(null)
const isChecking = ref(false)
const failed = ref(false)

const bytes = (value: number) => formatBytes(value, locale.value)

function dirCheck(
  id: 'data' | 'downloads' | 'library',
  dir: StorageDirCheck,
): WizardCheck {
  const base = `panel.wizard.storage.${id}`

  if (!dir.writable) {
    return {
      id,
      status: 'error',
      title: t(`${base}.readonly`),
      text: dir.path,
      mono: true,
      fix: t('panel.wizard.storage.fixWrite'),
    }
  }

  return {
    id,
    status: 'ok',
    title: t(dir.exists ? `${base}.ok` : `${base}.created`),
    text: dir.path,
    mono: true,
  }
}

const checks = computed<WizardCheck[]>(() => {
  const value = result.value

  if (failed.value) {
    return [
      {
        id: 'request',
        status: 'error',
        title: t('panel.wizard.storage.failed'),
        fix: t('panel.wizard.checks.retryFix'),
      },
    ]
  }

  if (!value) {
    return [
      {
        id: 'pending',
        status: 'pending',
        title: t('panel.wizard.storage.checking'),
      },
    ]
  }

  const space = {
    free: bytes(value.space.free),
    total: bytes(value.space.total),
  }
  const items = [
    dirCheck('data', value.data),
    dirCheck('downloads', value.downloads),
    dirCheck('library', value.library),
    {
      id: 'space',
      status:
        value.space.status === 'ok'
          ? 'ok'
          : value.space.status === 'low'
            ? 'warning'
            : 'error',
      title: t(`panel.wizard.storage.space.${value.space.status}`, space),
      text: t('panel.wizard.storage.space.text', space),
      fix:
        value.space.status === 'ok'
          ? undefined
          : t(`panel.wizard.storage.space.${value.space.status}Fix`),
    } satisfies WizardCheck,
  ]

  // Хардлинк — норма; reflink — сведение; копия — предупреждение с советом
  if (value.linkMode) {
    const mode = value.linkMode

    items.push({
      id: 'links',
      status:
        mode === 'hardlink' ? 'ok' : mode === 'reflink' ? 'info' : 'warning',
      title: t(`panel.wizard.storage.links.${mode}`),
      text: t(`panel.wizard.storage.links.${mode}Text`),
      fix:
        mode === 'copy' ? t('panel.wizard.storage.links.copyFix') : undefined,
    })
  }

  return items
})

const nextLabel = computed(() =>
  worstStatus(checks.value) === 'error'
    ? t('panel.wizard.storage.continueWithout')
    : undefined,
)

async function runCheck() {
  isChecking.value = true
  failed.value = false

  try {
    result.value = await checkStorage()
  }
  catch {
    failed.value = true
  }
  finally {
    isChecking.value = false
  }
}

// Новый лимит, запас или папка меняют оценку места и хардлинков
watch(
  () => {
    const value = storage.overview.value

    return (
      value
      && [
        value.policy.cacheLimit,
        value.policy.minFree,
        value.folders.downloads.path,
        value.folders.library.path,
      ].join(':')
    )
  },
  (key, previous) => {
    if (previous && key)
      runCheck()
  },
)

onMounted(() => {
  runCheck()
  storage.load()
})
</script>

<template>
  <header>
    <h1 class="text-2xl font-semibold tracking-tight text-balance">
      {{ t("panel.wizard.storage.title") }}
    </h1>
    <p class="mt-1.5 max-w-[58ch] text-muted-foreground">
      {{ t("panel.wizard.storage.text") }}
    </p>
  </header>

  <WizardChecks
    :title="t('panel.wizard.checks.title')"
    :checks="checks"
    :running="isChecking"
    @retry="runCheck"
  />

  <!-- Настройки — те же карточки, что в «Настройки → Хранилище» -->
  <div v-if="loading" class="grid gap-5" aria-busy="true">
    <Skeleton class="h-64 rounded-xl" />
    <Skeleton class="h-48 rounded-xl" />
    <Skeleton class="h-48 rounded-xl" />
  </div>
  <template v-else-if="storage.overview.value">
    <StorageFoldersCard :overview="storage.overview.value" />
    <StoragePolicyCards :overview="storage.overview.value" />
  </template>

  <WizardActions step="storage" :next-label="nextLabel" />
</template>
