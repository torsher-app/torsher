<script setup lang="ts">
import { reactive, ref, watch } from 'vue'

const props = defineProps<{ src?: string }>()

// Два слоя: новый кадр проявляется поверх старого, когда загрузился
const layers = reactive<(string | undefined)[]>([undefined, undefined])
const loaded = reactive([false, false])
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

    const back = front.value === 0 ? 1 : 0

    // Кадр уже лежит в заднем слое (вернулись к прошлому тайтлу): `src` тот
    // же, `load` не придёт — показываем сразу
    if (layers[back] === src) {
      if (loaded[back])
        front.value = back

      return
    }

    layers[back] = src
    loaded[back] = false
  },
  { immediate: true },
)

function onLoad(index: number) {
  loaded[index] = true

  if (layers[index] === props.src)
    front.value = index
}
</script>

<template>
  <div class="backdrop" aria-hidden="true">
    <!-- Своего кадра нет (файл без описания, раздача без подсказки) — общий
         фон, а не кадр прошлого тайтла и не пустота -->
    <div
      class="backdrop__fallback"
      :class="{ 'backdrop__fallback--shown': front === undefined }"
    />
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
.backdrop__fallback,
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
  /*
   * Постоянный слой: без него смена кадра на ТВ обходится вдвое дороже.
   * Именно transform — подсказка opacity такого эффекта не дала
   */
  will-change: transform;
}

.backdrop__image--shown {
  opacity: 1;
}

/* Мягкий отсвет акцента справа сверху и холодный снизу — цвета из токенов */
.backdrop__fallback {
  background:
    radial-gradient(ellipse 60% 70% at 78% 18%, rgba(232, 184, 74, 0.2), rgba(232, 184, 74, 0) 70%),
    radial-gradient(ellipse 50% 60% at 92% 88%, rgba(141, 182, 255, 0.12), rgba(141, 182, 255, 0) 70%),
    var(--color-surface);
  opacity: 0;
  transition: opacity calc(var(--motion-base) * 2) var(--motion-easing);
}

.backdrop__fallback--shown {
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
