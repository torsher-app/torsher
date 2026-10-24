<script setup lang="ts">
import type { TorrentSettingValues } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import LoadingButton from '~/components/LoadingButton.vue'
import SettingsCard from './SettingsCard.vue'

const props = defineProps<{
  values: TorrentSettingValues
  defaults: TorrentSettingValues
}>()

const { t } = useI18n()
const { save } = useTorrentSettings()

function integer(max: number, min: number, message: string) {
  return z
    .string()
    .trim()
    .regex(/^\d+$/, t('panel.settings.torrent.validation.integer'))
    .refine(value => Number(value) >= min && Number(value) <= max, message)
}

// Те же границы, что у DTO сервера
const schema = toTypedSchema(
  z.object({
    perTorrent: integer(
      1000,
      1,
      t('panel.settings.torrent.validation.perTorrent'),
    ),
    total: integer(10_000, 0, t('panel.settings.torrent.validation.total')),
  }),
)

function fieldsOf(values: TorrentSettingValues) {
  return {
    perTorrent: String(values.connsPerTorrent),
    total: String(values.connsTotal),
  }
}

const { handleSubmit, defineField, errors, isSubmitting, meta, resetForm }
  = useForm({
    validationSchema: schema,
    initialValues: fieldsOf(props.values),
  })

const [perTorrent, perTorrentProps] = defineField('perTorrent')
const [total, totalProps] = defineField('total')

watch(
  () => [props.values.connsPerTorrent, props.values.connsTotal],
  () => {
    if (!meta.value.dirty)
      resetForm({ values: fieldsOf(props.values) })
  },
)

const onSubmit = handleSubmit(async (values) => {
  await save({
    connsPerTorrent: Number(values.perTorrent),
    connsTotal: Number(values.total),
  })
  resetForm({ values: fieldsOf(props.values) })
  toast.success(t('panel.settings.torrent.saved'), {
    description: t('panel.settings.torrent.savedText'),
  })
})
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard
      :title="t('panel.settings.torrent.conns.title')"
      :description="t('panel.settings.torrent.conns.text')"
    >
      <div class="grid gap-2">
        <div class="flex flex-wrap gap-3">
          <div class="grid gap-2">
            <Label for="torrent-conns-per">
              {{ t("panel.settings.torrent.conns.perTorrent") }}
            </Label>
            <Input
              id="torrent-conns-per"
              v-model="perTorrent"
              v-bind="perTorrentProps"
              inputmode="numeric"
              autocomplete="off"
              class="w-28 tabular-nums"
              :aria-invalid="!!errors.perTorrent || undefined"
            />
          </div>
          <div class="grid gap-2">
            <Label for="torrent-conns-total">
              {{ t("panel.settings.torrent.conns.total") }}
            </Label>
            <Input
              id="torrent-conns-total"
              v-model="total"
              v-bind="totalProps"
              inputmode="numeric"
              autocomplete="off"
              class="w-28 tabular-nums"
              :aria-invalid="!!errors.total || undefined"
            />
          </div>
        </div>
        <p
          v-if="errors.perTorrent || errors.total"
          class="text-[12.5px] text-destructive"
        >
          {{ errors.perTorrent ?? errors.total }}
        </p>
        <p v-else class="text-[12.5px] text-muted-foreground">
          {{ t("panel.settings.torrent.conns.hint") }}
        </p>
      </div>
      <template #hint>
        {{
          t("panel.settings.torrent.defaultIs", {
            value: `${defaults.connsPerTorrent} / ${defaults.connsTotal}`,
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
