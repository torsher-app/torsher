<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  title: string
  // Из карточки тайтла: кадр на фон, логотип и «Сезон 1 · Серия 1 · Название»
  backdrop?: string
  logo?: string
  subtitle?: string
}>()

const logoFailed = ref(false)

watch(
  () => props.logo,
  () => {
    logoFailed.value = false
  },
)
</script>

<template>
  <!--
    Общий фон всех фаз до воспроизведения: подготовка, «Продолжить», ошибка.
    Шапка привязана к середине экрана снизу, содержимое — сверху: смена фазы
    меняет только содержимое, логотип и фон стоят на месте.
  -->
  <div class="stage">
    <img
      v-if="backdrop"
      class="stage__backdrop"
      :src="backdrop"
      alt=""
      decoding="async"
    >
    <div class="stage__shade" />

    <div class="stage__head">
      <img
        v-if="logo && !logoFailed"
        class="stage__logo"
        :src="logo"
        :alt="title"
        decoding="async"
        @error="logoFailed = true"
      >
      <p v-else class="stage__title">
        {{ title }}
      </p>
      <p v-if="subtitle" class="stage__subtitle">
        {{ subtitle }}
      </p>
    </div>

    <div class="stage__content">
      <slot />
    </div>

    <div v-if="$slots.bottom" class="stage__bottom">
      <slot name="bottom" />
    </div>
  </div>
</template>

<style scoped>
.stage {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
  background: var(--color-bg);
}

.stage__backdrop,
.stage__shade {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.stage__backdrop {
  object-fit: cover;
}

/* Кадр приглушён: текст, кнопки и лоадер читаются на светлом и тёмном */
.stage__shade {
  background-image:
    radial-gradient(ellipse at center, rgba(11, 13, 18, 0.55) 0%, rgba(11, 13, 18, 0.8) 70%),
    linear-gradient(0deg, var(--color-bg) 0%, rgba(11, 13, 18, 0) 40%);
}

.stage__head {
  position: absolute;
  right: var(--safe-x);
  bottom: 52%;
  left: var(--safe-x);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.stage__logo {
  max-width: calc(var(--u) * 720);
  max-height: calc(var(--u) * 220);
  object-fit: contain;
}

.stage__title {
  max-width: 100%;
  margin: 0;
  overflow: hidden;
  font-size: var(--font-size-xl);
  font-weight: 700;
  line-height: 1.05;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stage__subtitle {
  margin: var(--space-2) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-m);
}

.stage__content {
  position: absolute;
  top: calc(48% + var(--u) * 40);
  right: var(--safe-x);
  left: var(--safe-x);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.stage__bottom {
  position: absolute;
  right: var(--safe-x);
  bottom: var(--safe-y);
  left: var(--safe-x);
}
</style>
