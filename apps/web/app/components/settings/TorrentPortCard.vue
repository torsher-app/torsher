<script setup lang="ts">
import type { TorrentSettings } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import LoadingButton from '~/components/LoadingButton.vue'
import SettingsCard from './SettingsCard.vue'
import TorrentRestartBadge from './TorrentRestartBadge.vue'

const props = defineProps<{
  settings: TorrentSettings
}>()

const { t } = useI18n()
const { save } = useTorrentSettings()

const schema = toTypedSchema(
  z.object({
    port: z
      .string()
      .trim()
      .regex(/^\d+$/, t('panel.settings.torrent.validation.port'))
      .refine(
        value => Number(value) >= 1024 && Number(value) <= 65_535,
        t('panel.settings.torrent.validation.port'),
      ),
    upnp: z.boolean(),
  }),
)

function fieldsOf(settings: TorrentSettings) {
  return { port: String(settings.values.peerPort), upnp: settings.values.upnp }
}

const {
  handleSubmit,
  defineField,
  errors,
  isSubmitting,
  meta,
  resetForm,
  values,
} = useForm({
  validationSchema: schema,
  initialValues: fieldsOf(props.settings),
})

const [port, portProps] = defineField('port')
const [upnp] = defineField('upnp')

watch(
  () => [props.settings.values.peerPort, props.settings.values.upnp],
  () => {
    if (!meta.value.dirty)
      resetForm({ values: fieldsOf(props.settings) })
  },
)

// Порт из окружения опубликован в compose: другой порт туда не дойдёт
const portNote = computed(() => {
  const env = props.settings.peerPortEnv

  if (env && Number(values.port) !== env) {
    return {
      text: t('panel.settings.torrent.port.envMismatch', { port: env }),
      warn: true,
    }
  }

  return {
    text: t(
      env
        ? 'panel.settings.torrent.port.env'
        : 'panel.settings.torrent.port.docker',
    ),
    warn: false,
  }
})

const onSubmit = handleSubmit(async (fields) => {
  await save({ peerPort: Number(fields.port), upnp: fields.upnp })
  resetForm({ values: fieldsOf(props.settings) })
  toast.success(t('panel.settings.torrent.saved'), {
    description: t('panel.settings.torrent.savedRestart'),
  })
})
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard
      :title="t('panel.settings.torrent.port.title')"
      :description="t('panel.settings.torrent.port.text')"
    >
      <template #badge>
        <TorrentRestartBadge />
      </template>
      <div class="grid gap-2">
        <Label for="torrent-port">{{
          t("panel.settings.torrent.port.label")
        }}</Label>
        <Input
          id="torrent-port"
          v-model="port"
          v-bind="portProps"
          inputmode="numeric"
          autocomplete="off"
          class="w-full max-w-28 tabular-nums"
          :aria-invalid="!!errors.port || undefined"
        />
        <p v-if="errors.port" class="text-[12.5px] text-destructive">
          {{ errors.port }}
        </p>
        <p
          v-else
          class="text-[12.5px]"
          :class="portNote.warn ? 'text-warning' : 'text-muted-foreground'"
        >
          {{ portNote.text }}
        </p>
      </div>
      <div
        class="flex items-start justify-between gap-4 rounded-lg border border-input px-3 py-2.5"
      >
        <Label for="torrent-upnp" class="grid cursor-pointer gap-1 font-normal">
          <span class="font-semibold">{{
            t("panel.settings.torrent.port.upnp")
          }}</span>
          <span class="text-xs text-muted-foreground">
            {{ t("panel.settings.torrent.port.upnpHint") }}
          </span>
        </Label>
        <Switch id="torrent-upnp" v-model="upnp" />
      </div>
      <template #hint>
        {{
          t("panel.settings.torrent.defaultIs", {
            value: settings.defaults.peerPort,
          })
        }}
      </template>
      <template #action>
        <LoadingButton
          type="submit"
          size="sm"
          :loading="isSubmitting"
          :disabled="!meta.dirty"
        >
          {{ t("panel.common.save") }}
        </LoadingButton>
      </template>
    </SettingsCard>
  </form>
</template>
