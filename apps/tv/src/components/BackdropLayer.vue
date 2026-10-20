<script setup lang="ts">
import { reactive, ref, watch } from 'vue'

const props = defineProps<{ src?: string }>()

// Два слоя: новый кадр проявляется поверх старого, когда загрузился
const layers = reactive<(string | undefined)[]>([undefined, undefined])
const front = ref<number>()

watch(
  () => props.src,
  (src) => {
    if (!src) {
      front.value = undefined

      return
    }

    if (front.value !== undefined && layers[front.value] === src)
      return

    layers[front.value === 0 ? 1 : 0] = src
  },
  { immediate: true },
)

function onLoad(index: number) {
  if (layers[index] === props.src)
    front.value = index
}
</script>

<template>
  <div class="backdrop" aria-hidden="true">
    <template v-for="(layer, index) in layers" :key="index">
      <img
        v-if="layer"
        class="backdrop__image"
        :class="{ 'backdrop__image--shown': front === index }"
        :src="layer"
        alt=""
        decoding="async"
        @load="onLoad(index)"
      >
    </template>
    <div class="backdrop__scrim backdrop__scrim--left" />
    <div class="backdrop__scrim backdrop__scrim--bottom" />
  </div>
</template>

<style scoped>
.backdrop,
.backdrop__image,
.backdrop__scrim {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
}

.backdrop {
  overflow: hidden;
}

.backdrop__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: right center;
  opacity: 0;
  transition: opacity calc(var(--motion-base) * 2) var(--motion-easing);
}

.backdrop__image--shown {
  opacity: 1;
}

.backdrop__scrim--left {
  background: linear-gradient(
    90deg,
    var(--color-bg) 0%,
    rgba(11, 13, 18, 0.94) 22%,
    rgba(11, 13, 18, 0.55) 44%,
    rgba(11, 13, 18, 0) 66%
  );
}

.backdrop__scrim--bottom {
  background: linear-gradient(
    0deg,
    var(--color-bg) 0%,
    rgba(11, 13, 18, 0.96) 36%,
    rgba(11, 13, 18, 0.4) 56%,
    rgba(11, 13, 18, 0) 72%
  );
}
</style>
