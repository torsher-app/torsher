<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * Затемнённая пауза: OSD погас, кадр под скримом, слева внизу — что смотрим.
 * Всегда в DOM и меняет только `opacity`: появление не перерисовывает кадр.
 */
const props = defineProps<{
  visible: boolean
  title: string
  logo?: string
  // «Сезон 2 · Серия 5 · Название»
  subtitle?: string
  // Описание серии, без него — тайтла
  overview?: string
}>()

const { t } = useI18n()
const logoFailed = ref(false)

watch(
  () => props.logo,
  () => {
    logoFailed.value = false
  },
)
</script>

<template>
  <div
    class="pause-screen"
    :class="{ 'pause-screen--visible': visible }"
    aria-hidden="true"
  >
    <div class="pause-screen__info">
      <p class="pause-screen__label">
        {{ t("player.youAreWatching") }}
      </p>
      <img
        v-if="logo && !logoFailed"
        class="pause-screen__logo"
        :src="logo"
        :alt="title"
        decoding="async"
        @error="logoFailed = true"
      >
      <p v-else class="pause-screen__title">
        {{ title }}
      </p>
      <p v-if="subtitle" class="pause-screen__subtitle">
        {{ subtitle }}
      </p>
      <p v-if="overview" class="pause-screen__overview">
        {{ overview }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.pause-screen {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: rgba(0, 0, 0, 0.7);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.6s var(--motion-easing);
  will-change: opacity;
}

.pause-screen--visible {
  opacity: 1;
}

.pause-screen__info {
  position: absolute;
  bottom: calc(var(--u) * 140);
  left: var(--safe-x);
  max-width: calc(var(--u) * 900);
}

.pause-screen__label {
  margin: 0 0 var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  font-weight: 600;
}

.pause-screen__logo {
  display: block;
  max-width: calc(var(--u) * 560);
  max-height: calc(var(--u) * 180);
  object-fit: contain;
  object-position: left bottom;
}

.pause-screen__title {
  margin: 0;
  overflow: hidden;
  font-size: var(--font-size-xl);
  font-weight: 700;
  line-height: 1.05;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pause-screen__subtitle {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-m);
  font-weight: 600;
}

.pause-screen__overview {
  display: -webkit-box;
  margin: var(--space-2) 0 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  line-height: 1.45;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
</style>
