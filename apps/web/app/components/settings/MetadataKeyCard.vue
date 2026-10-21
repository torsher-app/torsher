<script setup lang="ts">
import type { MetadataSettings } from '@torsher/api-client'
import { CircleAlertIcon, ExternalLinkIcon } from '@lucide/vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import LoadingButton from '~/components/LoadingButton.vue'
import SecretInput from '~/components/SecretInput.vue'
import SettingsCard from './SettingsCard.vue'

const props = defineProps<{
  settings: MetadataSettings
}>()

const { t } = useI18n()
const { saveTmdbKey, checkTmdbKey } = useMetadataSettings()

const TMDB_API_SETTINGS = 'https://www.themoviedb.org/settings/api'
const MODES = ['app', 'custom'] as const

const hasCustomKey = computed(() => props.settings.tmdb.source === 'custom')
const isChecking = ref(false)

// Ключ нужен, только если своего ещё нет: иначе пустое поле — оставить сохранённый.
// Минимум — как в DTO сервера
const schema = computed(() =>
  toTypedSchema(
    z
      .object({
        mode: z.enum(MODES),
        key: z.string().trim().max(1000),
      })
      .superRefine((values, ctx) => {
        if (values.mode !== 'custom')
          return

        if ((values.key || !hasCustomKey.value) && values.key.length < 16) {
          ctx.addIssue({
            code: 'custom',
            path: ['key'],
            message: t('panel.settings.metadata.validation.key'),
          })
        }
      }),
  ),
)

function valuesOf(value: MetadataSettings) {
  return {
    mode:
      value.tmdb.source === 'custom' ? ('custom' as const) : ('app' as const),
    key: '',
  }
}

const {
  handleSubmit,
  defineField,
  errors,
  isSubmitting,
  meta,
  resetForm,
  values: form,
} = useForm({
  validationSchema: schema,
  initialValues: valuesOf(props.settings),
})

const [mode, modeProps] = defineField('mode')
const [key, keyProps] = defineField('key')

watch(
  () => props.settings,
  (value) => {
    if (!meta.value.dirty)
      resetForm({ values: valuesOf(value) })
  },
)

// Переключение на «свой ключ» без нового значения ничего не меняет на сервере
const canSave = computed(
  () =>
    meta.value.dirty
    && !(form.mode === 'custom' && hasCustomKey.value && !(form.key ?? '').trim()),
)

const onSubmit = handleSubmit(async (values) => {
  const saved = await saveTmdbKey(values.mode === 'custom' ? values.key : null)

  resetForm({ values: valuesOf(saved) })
  toast.success(
    t(
      values.mode === 'custom'
        ? 'panel.settings.metadata.savedCustom'
        : 'panel.settings.metadata.savedApp',
    ),
    { description: t('panel.settings.metadata.savedText') },
  )
})

async function onCheck() {
  const typed = form.mode === 'custom' ? (form.key ?? '').trim() : ''

  isChecking.value = true

  try {
    const result = await checkTmdbKey(typed || undefined)

    if (result.ok) {
      toast.success(t('panel.settings.metadata.check.ok'))
    }
    else {
      toast.error(
        t(`panel.settings.metadata.check.${result.kind ?? 'rejected'}`),
      )
    }
  }
  finally {
    isChecking.value = false
  }
}
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard
      :title="t('panel.settings.metadata.tmdbTitle')"
      :description="t('panel.settings.metadata.tmdbText')"
    >
      <Alert v-if="settings.tmdb.source === 'none'" variant="warning">
        <CircleAlertIcon />
        <AlertTitle>{{ t("panel.settings.metadata.noneTitle") }}</AlertTitle>
        <AlertDescription>
          {{ t("panel.settings.metadata.noneText") }}
        </AlertDescription>
      </Alert>

      <RadioGroup
        v-model="mode"
        v-bind="modeProps"
        class="grid gap-2 sm:grid-cols-2"
        :aria-label="t('panel.settings.metadata.tmdbTitle')"
      >
        <Label
          v-for="item in MODES"
          :key="item"
          :for="`tmdb-mode-${item}`"
          class="flex cursor-pointer items-start justify-between gap-2 rounded-lg border border-input px-3 py-2.5 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60"
        >
          <span class="grid gap-1">
            <span class="font-semibold">{{
              t(`panel.settings.metadata.${item}`)
            }}</span>
            <span class="text-xs text-muted-foreground">
              {{
                item === "app" && !settings.tmdb.hasAppKey
                  ? t("panel.settings.metadata.appMissing")
                  : t(`panel.settings.metadata.${item}Text`)
              }}
            </span>
          </span>
          <RadioGroupItem
            :id="`tmdb-mode-${item}`"
            :value="item"
            :disabled="item === 'app' && !settings.tmdb.hasAppKey"
          />
        </Label>
      </RadioGroup>

      <div v-if="mode === 'custom'" class="grid gap-2">
        <Label for="tmdb-key">{{ t("panel.settings.metadata.key") }}</Label>
        <SecretInput
          id="tmdb-key"
          v-model="key"
          v-bind="keyProps"
          autocomplete="off"
          class="font-mono"
          :placeholder="hasCustomKey ? '••••••••••••••••' : undefined"
          :show-label="t('panel.common.showKey')"
          :hide-label="t('panel.common.hideKey')"
          :aria-invalid="!!errors.key || undefined"
          aria-describedby="tmdb-key-hint"
        />
        <p
          v-if="errors.key"
          id="tmdb-key-hint"
          class="text-[12.5px] text-destructive"
        >
          {{ errors.key }}
        </p>
        <p
          v-else
          id="tmdb-key-hint"
          class="text-[12.5px] text-muted-foreground"
        >
          {{
            hasCustomKey
              ? t("panel.settings.metadata.keySaved")
              : t("panel.settings.metadata.keyHint")
          }}
        </p>
      </div>

      <template #hint>
        {{ t("panel.settings.metadata.where") }}
        <a
          :href="TMDB_API_SETTINGS"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
        >
          {{ t("panel.settings.metadata.whereLink") }}
          <ExternalLinkIcon class="size-3.5" aria-hidden="true" />
        </a>
      </template>
      <template #action>
        <div class="flex gap-2">
          <LoadingButton
            type="button"
            variant="outline"
            size="sm"
            :loading="isChecking"
            :disabled="isSubmitting"
            @click="onCheck"
          >
            {{ t("panel.settings.metadata.check.action") }}
          </LoadingButton>
          <LoadingButton
            type="submit"
            size="sm"
            :loading="isSubmitting"
            :disabled="!canSave"
          >
            {{ t("panel.common.save") }}
          </LoadingButton>
        </div>
      </template>
    </SettingsCard>
  </form>
</template>
