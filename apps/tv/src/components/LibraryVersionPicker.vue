<script setup lang="ts">
import type { LibraryFile } from '@torsher/api-client'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSourceLabels } from '../composables/useSourceLabels.ts'
import OptionsPanel from './OptionsPanel.vue'

const props = defineProps<{
  files: LibraryFile[]
  currentId?: string | null
}>()
const emit = defineEmits<{ select: [id: string], close: [] }>()
const { t } = useI18n()
const { sizeLabel } = useSourceLabels()
const options = computed(() =>
  props.files.map((file, index) => ({
    id: file.id,
    label: file.name || t('libraryVersions.version', { number: index + 1 }),
    hint: [file.quality, sizeLabel(file.size)].filter(Boolean).join(' · '),
    selected: file.id === props.currentId,
  })),
)
</script>

<template>
  <OptionsPanel
    :title="t('libraryVersions.title')"
    :options="options"
    @select="emit('select', $event)"
    @close="emit('close')"
  />
</template>
