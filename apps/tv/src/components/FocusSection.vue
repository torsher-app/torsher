<script setup lang="ts">
import type { SectionEdges } from '../focus/index.ts'
import { onMounted, watchEffect } from 'vue'
import { SECTION_ATTRIBUTE, useFocus } from '../focus/index.ts'

const props = defineProps<{
  name: string
  edges?: SectionEdges
  autofocus?: boolean
}>()

const focus = useFocus()

watchEffect(() => focus.setEdges(props.name, props.edges ?? {}))

// Дочерние v-focusable регистрируются раньше: их mounted срабатывает до mounted секции
onMounted(() => {
  if (props.autofocus)
    focus.activate(props.name)
})
</script>

<template>
  <div v-bind="{ [SECTION_ATTRIBUTE]: name }">
    <slot />
  </div>
</template>
