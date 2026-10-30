<script setup lang="ts">
import type { FollowSettings } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import * as z from 'zod'
import { Label } from '@/components/ui/label'
import AudioLanguageSelect from '~/components/follow/AudioLanguageSelect.vue'
import LoadingButton from '~/components/LoadingButton.vue'
import { FOLLOW_AUDIOS } from '~/lib/follow'
import SettingsCard from './SettingsCard.vue'

const props = defineProps<{
  audio: FollowSettings['audio']
}>()

const { t } = useI18n()
const { save } = useFollowSettings()

const schema = toTypedSchema(z.object({ audio: z.enum(FOLLOW_AUDIOS) }))

// Языка ещё нет — на сервере действует русская
function valuesOf(audio: FollowSettings['audio']) {
  return { audio: audio?.value ?? ('ru' as const) }
}

const { handleSubmit, defineField, isSubmitting, meta, resetForm } = useForm({
  validationSchema: schema,
  initialValues: valuesOf(props.audio),
})

const [audio] = defineField('audio')

// Подобранный язык можно подтвердить и не меняя его
const canSave = computed(
  () => meta.value.dirty || props.audio?.source !== 'user',
)

watch(
  () => props.audio,
  (value) => {
    if (!meta.value.dirty)
      resetForm({ values: valuesOf(value) })
  },
)

const onSubmit = handleSubmit(async (values) => {
  const saved = await save({ audio: values.audio })

  resetForm({ values: valuesOf(saved.audio) })
  toast.success(t('panel.settings.follow.saved'), {
    description: t('panel.settings.follow.audio.title'),
  })
})
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard
      :title="t('panel.settings.follow.audio.title')"
      :description="t('panel.settings.follow.audio.description')"
    >
      <div class="grid max-w-80 gap-2">
        <Label for="follow-server-audio" class="sr-only">
          {{ t("panel.settings.follow.audio.title") }}
        </Label>
        <AudioLanguageSelect id="follow-server-audio" v-model="audio" />
      </div>
      <template #hint>
        {{
          !props.audio
            ? t("panel.settings.follow.audio.unset")
            : props.audio.source === "auto"
              ? t("panel.settings.follow.audio.auto")
              : t("panel.follow.rules.audioHint")
        }}
      </template>
      <template #action>
        <LoadingButton
          type="submit"
          size="sm"
          :loading="isSubmitting"
          :disabled="!canSave"
        >
          {{ t("panel.common.save") }}
        </LoadingButton>
      </template>
    </SettingsCard>
  </form>
</template>
