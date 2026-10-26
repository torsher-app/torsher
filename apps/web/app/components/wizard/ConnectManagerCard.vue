<script setup lang="ts">
import type { DiscoveredManager } from '@torsher/api-client'
import type { SourceErrorKind } from '~/composables/useSources'
import { CircleAlertIcon } from '@lucide/vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import LoadingButton from '~/components/LoadingButton.vue'
import SecretInput from '~/components/SecretInput.vue'
import SettingsCard from '~/components/settings/SettingsCard.vue'
import { sourceErrorKind } from '~/composables/useSources'
import { fieldOfSourceError } from '~/lib/sourceForms'

/** Найденные на сервере менеджеры: подключение — тот же импорт, что в «Источниках» */
const props = defineProps<{
  found: DiscoveredManager[]
}>()

const { t } = useI18n()
const { importManager } = useSources()

const serverError = ref<SourceErrorKind | null>(null)

// Ключ — по правилам DTO импорта: непустой, до 500 символов
const schema = toTypedSchema(
  z.object({
    url: z.string().min(1),
    apiKey: z
      .string()
      .trim()
      .min(1, t('panel.sources.validation.apiKey'))
      .max(500),
  }),
)

const { handleSubmit, defineField, errors, isSubmitting } = useForm({
  validationSchema: schema,
  initialValues: { url: props.found[0]?.url ?? '', apiKey: '' },
})

const [url, urlProps] = defineField('url')
const [apiKey, apiKeyProps] = defineField('apiKey')

const selected = computed(
  () => props.found.find(item => item.url === url.value) ?? props.found[0],
)
const keyInvalid = computed(
  () =>
    !!errors.value.apiKey
    || (serverError.value !== null
      && fieldOfSourceError(serverError.value) === 'apiKey'),
)

const onSubmit = handleSubmit(async (values) => {
  const manager = props.found.find(item => item.url === values.url)

  if (!manager)
    return

  serverError.value = null

  try {
    const result = await importManager({
      kind: manager.kind,
      url: manager.url,
      apiKey: values.apiKey,
    })

    const name = t(`panel.kinds.${manager.kind}`)

    toast.success(t('panel.sources.managers.imported', { manager: name }), {
      description:
        result.manager.indexerCount > 0
          ? t('panel.sources.managers.importedText', result.added)
          : t('panel.sources.managers.importedEmpty', { manager: name }),
    })
  }
  catch (err) {
    serverError.value = await sourceErrorKind(err)
  }
})
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard
      :title="t('panel.wizard.sources.connect.title')"
      :description="t('panel.wizard.sources.connect.text')"
    >
      <Alert v-if="serverError" variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>
          {{ t(`panel.sources.errorTitles.${serverError}`) }}
        </AlertTitle>
        <AlertDescription>
          {{ t(`panel.sources.errors.${serverError}`) }}
        </AlertDescription>
      </Alert>

      <RadioGroup
        v-model="url"
        v-bind="urlProps"
        class="grid gap-2 sm:grid-cols-2"
        :aria-label="t('panel.wizard.sources.connect.title')"
      >
        <Label
          v-for="(item, index) in found"
          :key="item.url"
          :for="`found-${index}`"
          class="flex cursor-pointer items-start justify-between gap-2 rounded-lg border border-input px-3 py-2.5 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary"
        >
          <span class="grid min-w-0 gap-1">
            <span class="flex items-baseline gap-2">
              <span class="font-semibold">{{
                t(`panel.kinds.${item.kind}`)
              }}</span>
              <Badge variant="success">
                {{ t("panel.wizard.sources.found") }}
              </Badge>
            </span>
            <span class="font-mono text-xs break-all text-muted-foreground">
              {{ item.url }}
            </span>
          </span>
          <RadioGroupItem :id="`found-${index}`" :value="item.url" />
        </Label>
      </RadioGroup>

      <div class="grid gap-2">
        <Label for="found-api-key">{{
          t("panel.sources.importDialog.apiKey")
        }}</Label>
        <SecretInput
          id="found-api-key"
          v-model="apiKey"
          v-bind="apiKeyProps"
          autocomplete="off"
          class="font-mono"
          :show-label="t('panel.common.showKey')"
          :hide-label="t('panel.common.hideKey')"
          :aria-invalid="keyInvalid || undefined"
          aria-describedby="found-api-key-hint"
        />
        <p
          v-if="errors.apiKey"
          id="found-api-key-hint"
          class="text-[12.5px] text-destructive"
        >
          {{ errors.apiKey }}
        </p>
        <p
          v-else
          id="found-api-key-hint"
          class="text-[12.5px] text-muted-foreground"
        >
          {{
            t(
              `panel.sources.importDialog.keyHint.${selected?.kind ?? "prowlarr"}`,
            )
          }}
        </p>
      </div>

      <template #hint>
        {{ t("panel.wizard.sources.connect.hint") }}
      </template>
      <template #action>
        <LoadingButton type="submit" size="sm" :loading="isSubmitting">
          {{ t("panel.wizard.sources.connect.submit") }}
        </LoadingButton>
      </template>
    </SettingsCard>
  </form>
</template>
