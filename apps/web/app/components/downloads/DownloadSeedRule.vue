<script setup lang="ts">
import type { SeedRule, Torrent } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import LoadingButton from '~/components/LoadingButton.vue'
import SeedRuleFields from '~/components/settings/SeedRuleFields.vue'
import { seedRuleSchema } from '~/lib/seedRuleSchema'
import {
  DEFAULT_RULE,
  seedRuleFields,
  seedRuleOf,
} from '~/lib/torrentSettings'

/** Своё правило раздачи закреплённой загрузки — в её карточке */
const props = defineProps<{
  torrent: Torrent
}>()

const { t } = useI18n()
const { setSeedRule } = useTorrents()
const { summary } = useSeedRuleText()
const torrentSettings = useTorrentSettings()

onMounted(() => {
  if (torrentSettings.state.value === 'idle')
    void torrentSettings.load()
})

const { handleSubmit, isSubmitting, meta, resetForm } = useForm({
  validationSchema: toTypedSchema(seedRuleSchema(t, true)),
  initialValues: seedRuleFields(props.torrent.seeding.rule),
})

// Другая загрузка или правило сменилось на сервере: нетронутая форма подхватывает
watch(
  () => [props.torrent.id, JSON.stringify(props.torrent.seeding.rule)],
  ([id], [previousId]) => {
    if (id !== previousId || !meta.value.dirty)
      resetForm({ values: seedRuleFields(props.torrent.seeding.rule) })
  },
)

// «Как в настройках» называет общее правило: из настроек, а без своего
// правила его же показывает действующее
const defaultLabel = computed(() => {
  const general
    = torrentSettings.settings.value?.values.seedRule
      ?? (props.torrent.seeding.rule ? null : props.torrent.seeding.effective)

  return general
    ? t('panel.torrents.card.seedRuleDefault', { rule: summary(general) })
    : t('panel.torrents.card.seedRuleDefaultPlain')
})

const onSubmit = handleSubmit(async (values) => {
  const rule
    = values.mode === DEFAULT_RULE
      ? null
      : seedRuleOf({ ...values, mode: values.mode as SeedRule['mode'] })

  const updated = await setSeedRule(props.torrent.id, rule)

  resetForm({ values: seedRuleFields(updated.seeding.rule) })
  toast.success(t('panel.torrents.card.seedRuleSaved'), {
    description: props.torrent.name,
  })
})
</script>

<template>
  <form class="grid gap-3" novalidate @submit="onSubmit">
    <div>
      <h3 class="text-xs font-medium text-muted-foreground">
        {{ t("panel.torrents.card.seedRule") }}
      </h3>
      <p class="mt-0.5 text-[12.5px] text-muted-foreground">
        {{ t("panel.torrents.card.seedRuleHint") }}
      </p>
    </div>
    <SeedRuleFields
      :id-prefix="`download-seed-${torrent.id}`"
      :default-label="defaultLabel"
    />
    <LoadingButton
      type="submit"
      size="sm"
      variant="outline"
      class="justify-self-start"
      :loading="isSubmitting"
      :disabled="!meta.dirty"
    >
      {{ t("panel.common.save") }}
    </LoadingButton>
  </form>
</template>
