<script setup lang="ts">
import ActionButton from '../ActionButton.vue'

defineProps<{ label: string }>()
const emit = defineEmits<{ skip: [] }>()
</script>

<template>
  <ActionButton
    class="player-skip"
    icon="next"
    :label="label"
    tabindex="-1"
    @mousemove.stop
    @mousedown.prevent
    @click.stop="emit('skip')"
  />
</template>

<style scoped>
.player-skip {
  position: absolute;
  right: var(--safe-x);
  bottom: calc(var(--u) * 300);
  margin-right: 0;
}

.player-skip:hover {
  background: var(--color-focus);
  color: var(--color-bg);
}

:global([data-platform='web']) .player-skip {
  cursor: pointer;
}
</style>
