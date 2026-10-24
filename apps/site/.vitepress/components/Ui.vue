<script setup lang="ts">
import { computed } from 'vue'
import { label } from '../ui.ts'

/**
 * A screen, button or setting name exactly as the app shows it. `k` takes one
 * key of `@torsher/i18n` or several separated by spaces for a path:
 * `<Ui k="panel.nav.settings panel.settings.nav.playback" />` → Settings → Playback.
 */
const props = defineProps<{ k: string }>()

const text = computed(() => props.k.trim().split(/\s+/).map(label).join(' → '))
</script>

<template>
  <span class="ui-label">{{ text }}</span>
</template>
