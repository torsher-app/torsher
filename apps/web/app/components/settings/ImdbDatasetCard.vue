<script setup lang="ts">
import type { ImdbDatasetStatus } from '@torsher/api-client'
import {
  CircleAlertIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import LoadingButton from '~/components/LoadingButton.vue'
import { formatDate } from '~/lib/format'
import SettingsCard from './SettingsCard.vue'

const props = defineProps<{
  status: ImdbDatasetStatus
}>()

const { t, locale } = useI18n()
const { setImdbEnabled, refreshImdb } = useMetadataSettings()

const IMDB_TERMS
  = 'https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX'

const isToggling = ref(false)
const isRefreshing = ref(false)
const isUpdating = computed(() => props.status.state === 'updating')

const summary = computed(() => {
  const { count, updatedAt } = props.status

  if (count === undefined || !updatedAt)
    return ''

  return t('panel.settings.metadata.imdb.ready', {
    date: formatDate(updatedAt, locale.value),
    count: new Intl.NumberFormat(locale.value.replace('_', '-')).format(count),
  })
})

const failure = computed(() =>
  props.status.error
    ? t(`panel.settings.metadata.imdb.error.${props.status.error.kind}`)
    : '',
)

async function onToggle(enabled: boolean) {
  isToggling.value = true

  try {
    await setImdbEnabled(enabled)
  }
  finally {
    isToggling.value = false
  }
}

async function onRefresh() {
  isRefreshing.value = true

  try {
    await refreshImdb()
  }
  finally {
    isRefreshing.value = false
  }
}
</script>

<template>
  <SettingsCard
    :title="t('panel.settings.metadata.imdb.title')"
    :description="t('panel.settings.metadata.imdb.text')"
  >
    <div
      class="flex items-start justify-between gap-4 rounded-lg border border-input px-3 py-2.5"
    >
      <Label for="imdb-enabled" class="grid cursor-pointer gap-1 font-normal">
        <span class="font-semibold">{{
          t("panel.settings.metadata.imdb.toggle")
        }}</span>
        <span class="text-xs text-muted-foreground">
          {{ t("panel.settings.metadata.imdb.terms") }}
          <a
            :href="IMDB_TERMS"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
          >
            {{ t("panel.settings.metadata.imdb.termsLink") }}
            <ExternalLinkIcon class="size-3.5" aria-hidden="true" />
          </a>
        </span>
      </Label>
      <Switch
        id="imdb-enabled"
        :model-value="status.enabled"
        :disabled="isToggling"
        @update:model-value="onToggle"
      />
    </div>
    <p class="text-xs text-muted-foreground">
      {{ t("about.imdbNotice") }}
    </p>

    <template #hint>
      <!-- Одна строка в любом состоянии: футер не меняет высоту -->
      <span class="inline-flex min-w-0 items-center gap-1.5" aria-live="polite">
        <template v-if="status.state === 'off'">
          {{ t("panel.settings.metadata.imdb.off") }}
        </template>
        <template v-else-if="isUpdating">
          <LoaderCircleIcon
            class="size-3.5 shrink-0 animate-spin"
            aria-hidden="true"
          />
          {{ t("panel.settings.metadata.imdb.updating") }}
        </template>
        <template v-else-if="status.state === 'ready'">
          {{ summary }}
          <span
            v-if="failure"
            class="inline-flex items-center gap-1 text-destructive"
          >
            <CircleAlertIcon class="size-3.5 shrink-0" aria-hidden="true" />
            {{ t("panel.settings.metadata.imdb.lastCheckFailed") }}
          </span>
        </template>
        <template v-else-if="status.state === 'error'">
          <CircleAlertIcon
            class="size-3.5 shrink-0 text-destructive"
            aria-hidden="true"
          />
          {{ failure }}
        </template>
        <template v-else>
          {{ t("panel.settings.metadata.imdb.empty") }}
        </template>
      </span>
    </template>
    <template #action>
      <LoadingButton
        type="button"
        variant="outline"
        size="sm"
        :loading="isRefreshing || isUpdating"
        :disabled="!status.enabled || isToggling"
        @click="onRefresh"
      >
        {{ t("panel.settings.metadata.imdb.refresh") }}
      </LoadingButton>
    </template>
  </SettingsCard>
</template>
