<script setup lang="ts">
import type { FollowAudio } from '~/lib/follow'
import { useI18n } from 'vue-i18n'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FOLLOW_AUDIOS } from '~/lib/follow'

/**
 * Язык озвучки: оригинал и языки дорожек. С `serverLanguage` первым идёт
 * «Как у сервера (…)» со значением `server`.
 */
const props = defineProps<{
  id: string
  serverLanguage?: FollowAudio
}>()

// vee-validate отдаёт поле как `string | undefined`
const model = defineModel<string | undefined>()

const { t } = useI18n()

function label(value: string) {
  return value === 'server'
    ? t('panel.follow.rules.audioServer', {
        language: t(`audioLanguages.${props.serverLanguage}`),
      })
    : t(`audioLanguages.${value}`)
}

const options = computed(() =>
  props.serverLanguage ? ['server', ...FOLLOW_AUDIOS] : [...FOLLOW_AUDIOS],
)
</script>

<template>
  <Select v-model="model">
    <SelectTrigger :id="id" class="w-full">
      <SelectValue>{{ model && label(model) }}</SelectValue>
    </SelectTrigger>
    <SelectContent>
      <SelectItem v-for="value in options" :key="value" :value="value">
        {{ label(value) }}
      </SelectItem>
    </SelectContent>
  </Select>
</template>
