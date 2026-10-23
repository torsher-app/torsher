<script setup lang="ts">
import type { UnmatchedGroup } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import LoadingButton from '~/components/LoadingButton.vue'
import { formatBytes } from '~/lib/format'

/** Релиз подключённой папки без тайтла: «Похоже на …» с подтверждением или выбор */
const props = defineProps<{
  group: UnmatchedGroup
  busy: boolean
}>()

const emit = defineEmits<{
  confirm: [titleId: string]
  fix: []
}>()

const { t, locale } = useI18n()
const suggestion = useTitleInfo(() => props.group.suggestion)

const status = computed(() => {
  if (props.group.status === 'unsure' && suggestion.value) {
    return t('panel.torrents.match.unsure', {
      title: [suggestion.value.title, suggestion.value.year]
        .filter(Boolean)
        .join(', '),
    })
  }

  return t('panel.library.unmatched.status')
})

const meta = computed(() =>
  [
    props.group.libraryName,
    t('panel.library.folder.files', props.group.files),
    formatBytes(props.group.size, locale.value),
  ].join(' · '),
)
</script>

<template>
  <li
    class="grid gap-2 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
  >
    <div class="grid min-w-0 gap-0.5">
      <span class="truncate font-mono text-xs" :title="group.group">{{
        group.name
      }}</span>
      <span class="text-[12.5px] text-muted-foreground tabular-nums">{{
        meta
      }}</span>
      <span class="text-[12.5px]">{{ status }}</span>
    </div>
    <div class="flex items-center gap-2">
      <LoadingButton
        v-if="group.status === 'unsure' && group.suggestion"
        size="sm"
        :loading="busy"
        @click="emit('confirm', group.suggestion)"
      >
        {{ t("panel.torrents.match.confirm") }}
      </LoadingButton>
      <Button size="sm" variant="outline" :disabled="busy" @click="emit('fix')">
        {{ t("panel.torrents.match.fix") }}
      </Button>
    </div>
  </li>
</template>
