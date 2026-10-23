<script setup lang="ts">
import type { SectionEdges } from '../focus/index.ts'
import { onActivated, onMounted, watchEffect } from 'vue'
import { SECTION_ATTRIBUTE, useFocus } from '../focus/index.ts'

const props = defineProps<{
  name: string
  edges?: SectionEdges
  autofocus?: boolean
  // Секция сама двигает контент под фокус (ряд на transform)
  manualScroll?: boolean
  // Колесо здесь не шагает, а уводит фокус в эту секцию
  wheelTarget?: string
}>()

const focus = useFocus()

function configure() {
  focus.configure(props.name, {
    edges: props.edges,
    manualScroll: props.manualScroll,
    wheelTarget: props.wheelTarget,
  })
}

watchEffect(configure)

// Секции с этим именем бывают у нескольких экранов в KeepAlive (карточки
// разных тайтлов): вернувшийся экран снова задаёт свои переходы
onActivated(configure)

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
