<script setup lang="ts">
import type { UpdateStatusResponse } from '@torsher/api-client'
import {
  ArrowUpCircleIcon,
  CircleAlertIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
} from '@lucide/vue'
import { useNow } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import LoadingButton from '~/components/LoadingButton.vue'
import SettingsCard from '~/components/settings/SettingsCard.vue'
import { formatDate, formatRelative } from '~/lib/format'
import UpdateDialog from './UpdateDialog.vue'

const props = defineProps<{
  status: UpdateStatusResponse
}>()

const { t, locale } = useI18n()
const { check, saveSettings } = useUpdates()
const now = useNow({ interval: 60_000 })

const isSaving = ref(false)
const isChecking = ref(false)
const dialogOpen = ref(false)

// Проверка недоступна в самой сборке: переключатели тогда не нужны
const unavailable = computed(
  () => props.status.state === 'dev' || props.status.state === 'unsupported',
)

const choiceClass
  = 'relative grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5 rounded-xl border border-input p-3.5 has-[[data-state=checked]]:border-primary has-[[data-disabled]]:cursor-default has-[[data-disabled]]:opacity-60'

async function save(values: { enabled: boolean, channel: 'stable' | 'beta' }) {
  isSaving.value = true

  try {
    await saveSettings(values)
  }
  catch {
    // Ошибку запроса уже показал тостом клиент API
  }
  finally {
    isSaving.value = false
  }
}

function onToggle(enabled: boolean) {
  void save({ enabled, channel: props.status.channel })
}

function onChannel(value: unknown) {
  if (value === 'stable' || value === 'beta')
    void save({ enabled: props.status.enabled, channel: value })
}

async function onCheck() {
  isChecking.value = true

  try {
    await check()
  }
  catch {
    // Ошибку запроса уже показал тостом клиент API
  }
  finally {
    isChecking.value = false
  }
}

const checkedAgo = computed(() =>
  props.status.checkedAt
    ? formatRelative(props.status.checkedAt, locale.value, now.value.getTime())
    : '',
)
</script>

<template>
  <SettingsCard
    :title="t('panel.updates.title')"
    :description="t('panel.updates.text')"
  >
    <section
      v-if="status.latest"
      class="grid gap-2.5 rounded-lg bg-primary/5 p-3.5"
      aria-labelledby="updates-latest"
    >
      <div class="flex items-start gap-2.5">
        <ArrowUpCircleIcon
          class="mt-0.5 size-4 shrink-0 text-primary"
          aria-hidden="true"
        />
        <div class="grid gap-0.5">
          <h3
            id="updates-latest"
            class="text-[14px] font-semibold tabular-nums"
          >
            {{
              t("panel.updates.available", { version: status.latest.version })
            }}
          </h3>
          <p
            v-if="status.latest.publishedAt"
            class="text-[12.5px] text-muted-foreground tabular-nums"
          >
            {{
              t("panel.updates.published", {
                date: formatDate(status.latest.publishedAt, locale),
              })
            }}
          </p>
        </div>
      </div>
      <ul
        v-if="status.latest.notes.length"
        class="ml-6.5 grid list-disc gap-1 pl-4 text-[13px] marker:text-muted-foreground"
      >
        <li v-for="(note, index) in status.latest.notes" :key="index">
          {{ note }}
        </li>
      </ul>
      <div class="flex flex-wrap gap-2 pl-6.5">
        <Button size="sm" @click="dialogOpen = true">
          {{ t("panel.updates.howTo") }}
        </Button>
        <Button size="sm" variant="outline" as-child>
          <a
            :href="status.latest.url"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ t("panel.updates.whatsNew") }}
            <ExternalLinkIcon aria-hidden="true" />
          </a>
        </Button>
      </div>
    </section>

    <template v-if="!unavailable">
      <div
        class="flex items-start justify-between gap-4 rounded-lg border border-input px-3 py-2.5"
      >
        <Label
          for="updates-enabled"
          class="grid cursor-pointer gap-1 font-normal"
        >
          <span class="font-semibold">{{ t("panel.updates.toggle") }}</span>
          <span class="text-xs text-muted-foreground">
            {{ t("panel.updates.toggleText") }}
          </span>
        </Label>
        <Switch
          id="updates-enabled"
          :model-value="status.enabled"
          :disabled="isSaving"
          @update:model-value="onToggle"
        />
      </div>

      <fieldset class="grid gap-2">
        <legend class="mb-2 text-[13.5px] font-medium">
          {{ t("panel.updates.channel") }}
        </legend>
        <RadioGroup
          :model-value="status.channel"
          :disabled="isSaving || !status.enabled"
          class="grid gap-2.5 sm:grid-cols-2"
          @update:model-value="onChannel"
        >
          <Label :class="choiceClass">
            <RadioGroupItem value="stable" class="mt-0.5" />
            <span class="grid gap-0.5">
              <span class="font-medium">{{
                t("panel.updates.channels.stable")
              }}</span>
              <span class="text-[12.5px] font-normal text-muted-foreground">
                {{ t("panel.updates.channels.stableText") }}
              </span>
            </span>
          </Label>
          <Label :class="choiceClass">
            <RadioGroupItem value="beta" class="mt-0.5" />
            <span class="grid gap-0.5">
              <span class="font-medium">{{
                t("panel.updates.channels.beta")
              }}</span>
              <span class="text-[12.5px] font-normal text-muted-foreground">
                {{ t("panel.updates.channels.betaText") }}
              </span>
            </span>
          </Label>
        </RadioGroup>
      </fieldset>
    </template>

    <template #hint>
      <!-- Одна строка в любом состоянии: футер не меняет высоту -->
      <span
        class="inline-flex min-w-0 items-center gap-1.5 tabular-nums"
        aria-live="polite"
      >
        <template v-if="status.state === 'checking' || isChecking">
          <LoaderCircleIcon
            class="size-3.5 shrink-0 animate-spin"
            aria-hidden="true"
          />
          {{ t("panel.updates.state.checking") }}
        </template>
        <!-- Неудачная последняя проверка видна и при уже найденной версии -->
        <template v-else-if="status.error">
          <CircleAlertIcon
            class="size-3.5 shrink-0 text-destructive"
            aria-hidden="true"
          />
          {{ t(`panel.updates.error.${status.error.kind}`) }}
        </template>
        <template
          v-else-if="
            (status.state === 'current' || status.state === 'available')
              && checkedAgo
          "
        >
          {{ t(`panel.updates.state.${status.state}`, { time: checkedAgo }) }}
        </template>
        <template v-else>
          {{ t(`panel.updates.state.${status.state}`) }}
        </template>
      </span>
    </template>
    <template v-if="!unavailable" #action>
      <LoadingButton
        type="button"
        variant="outline"
        size="sm"
        :loading="isChecking"
        :disabled="!status.enabled || isSaving"
        @click="onCheck"
      >
        {{ t("panel.updates.check") }}
      </LoadingButton>
    </template>

    <UpdateDialog
      v-if="status.latest"
      v-model:open="dialogOpen"
      :version="status.latest.version"
      :channel="status.channel"
      :release-url="status.latest.url"
      :docs-url="status.docsUrl"
    />
  </SettingsCard>
</template>
