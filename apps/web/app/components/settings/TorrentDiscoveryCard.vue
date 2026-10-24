<script setup lang="ts">
import type { TorrentSettingValues } from '@torsher/api-client'
import { TriangleAlertIcon } from '@lucide/vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import LoadingButton from '~/components/LoadingButton.vue'
import SettingsCard from './SettingsCard.vue'
import TorrentRestartBadge from './TorrentRestartBadge.vue'

const props = defineProps<{
  values: TorrentSettingValues
}>()

const { t } = useI18n()
const { save } = useTorrentSettings()

function fieldsOf(values: TorrentSettingValues) {
  return { dht: values.dht, pex: values.pex }
}

const { handleSubmit, defineField, isSubmitting, meta, resetForm } = useForm({
  validationSchema: toTypedSchema(
    z.object({ dht: z.boolean(), pex: z.boolean() }),
  ),
  initialValues: fieldsOf(props.values),
})

const [dht] = defineField('dht')
const [pex] = defineField('pex')

watch(
  () => [props.values.dht, props.values.pex],
  () => {
    if (!meta.value.dirty)
      resetForm({ values: fieldsOf(props.values) })
  },
)

const current = computed(() => {
  const list = [props.values.dht && 'DHT', props.values.pex && 'PEX'].filter(
    Boolean,
  )

  return list.length
    ? t('panel.settings.torrent.discovery.on', { list: list.join(', ') })
    : t('panel.settings.torrent.discovery.off')
})

const switches = [
  { key: 'dht', model: dht },
  { key: 'pex', model: pex },
] as const

const onSubmit = handleSubmit(async (fields) => {
  await save(fields)
  resetForm({ values: fields })
  toast.success(t('panel.settings.torrent.saved'), {
    description: t('panel.settings.torrent.savedRestart'),
  })
})
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard
      :title="t('panel.settings.torrent.discovery.title')"
      :description="t('panel.settings.torrent.discovery.text')"
    >
      <template #badge>
        <TorrentRestartBadge />
      </template>
      <div class="grid gap-2">
        <div
          v-for="item in switches"
          :key="item.key"
          class="flex items-start justify-between gap-4 rounded-lg border border-input px-3 py-2.5"
        >
          <Label
            :for="`torrent-${item.key}`"
            class="grid cursor-pointer gap-1 font-normal"
          >
            <span class="font-semibold">{{
              t(`panel.settings.torrent.discovery.${item.key}`)
            }}</span>
            <span class="text-xs text-muted-foreground">
              {{ t(`panel.settings.torrent.discovery.${item.key}Hint`) }}
            </span>
          </Label>
          <Switch :id="`torrent-${item.key}`" v-model="item.model.value" />
        </div>
      </div>
      <Alert v-if="!dht" variant="warning">
        <TriangleAlertIcon />
        <AlertDescription>
          {{ t("panel.settings.torrent.discovery.warning") }}
        </AlertDescription>
      </Alert>
      <template #hint>
        {{ current }}
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
