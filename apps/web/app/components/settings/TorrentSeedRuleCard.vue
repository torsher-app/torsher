<script setup lang="ts">
import type { SeedRule } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import LoadingButton from '~/components/LoadingButton.vue'
import { seedRuleSchema } from '~/lib/seedRuleSchema'
import { seedRuleFields, seedRuleOf } from '~/lib/torrentSettings'
import SeedRuleFields from './SeedRuleFields.vue'
import SettingsCard from './SettingsCard.vue'

const props = defineProps<{
  rule: SeedRule
  defaultRule: SeedRule
}>()

const { t } = useI18n()
const { save } = useTorrentSettings()
const { summary } = useSeedRuleText()

const { handleSubmit, isSubmitting, meta, resetForm } = useForm({
  validationSchema: toTypedSchema(seedRuleSchema(t, false)),
  initialValues: seedRuleFields(props.rule),
})

watch(
  () => props.rule,
  (rule) => {
    if (!meta.value.dirty)
      resetForm({ values: seedRuleFields(rule) })
  },
)

const onSubmit = handleSubmit(async (values) => {
  const rule = seedRuleOf({
    ...values,
    mode: values.mode as SeedRule['mode'],
  })

  await save({ seedRule: rule })
  resetForm({ values: seedRuleFields(rule) })
  toast.success(t('panel.settings.torrent.saved'), {
    description: t('panel.settings.torrent.savedText'),
  })
})
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard
      :title="t('panel.settings.torrent.seedRule.title')"
      :description="t('panel.settings.torrent.seedRule.text')"
    >
      <SeedRuleFields id-prefix="torrent-seed" />
      <p class="text-[12.5px] text-muted-foreground">
        {{ t("panel.settings.torrent.seedRule.hint") }}
      </p>
      <template #hint>
        {{
          t("panel.settings.torrent.defaultIs", {
            value: summary(defaultRule),
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
