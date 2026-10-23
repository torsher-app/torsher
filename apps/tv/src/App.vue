<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import AppScreensaver from './components/AppScreensaver.vue'
import TitleActions from './components/TitleActions.vue'
import { useScreensaver } from './composables/useScreensaver.ts'
import { session } from './session.ts'

const currentRoute = useRoute()
const cacheKey = ref(session.profile?.id)

// Пока открыт выбор профиля, ключ стоит: иначе KeepAlive пересоздал бы и сам
// экран выбора посреди перехода дальше
watchEffect(() => {
  if (currentRoute.path !== '/profiles')
    cacheKey.value = session.profile?.id
})

// В плеере заставки нет: ни при просмотре, ни на паузе — там своё затемнение
const { active: screensaverActive } = useScreensaver(
  () => !currentRoute.path.startsWith('/play/'),
)
</script>

<template>
  <!--
    Главная, поиск и «Источники» переживают переход дальше: по Back возвращаемся к
    тем же рядам, результатам и раздаче. Ключ по пути: «Главная», «Фильмы» и
    «Сериалы» — отдельные экраны, «Источники» — свои у каждого тайтла.
    Смена профиля сбрасывает их: ряды, прогресс и язык — уже другого зрителя.
  -->
  <RouterView v-slot="{ Component, route }">
    <KeepAlive
      :key="cacheKey"
      :include="['HomePage', 'SearchPage', 'SourcesPage', 'MinePage']"
    >
      <component :is="Component" :key="route.path" />
    </KeepAlive>
  </RouterView>
  <!-- Меню действий тайтла — поверх любого экрана: его открывает постер где угодно -->
  <TitleActions />

  <Transition name="screensaver">
    <AppScreensaver v-if="screensaverActive" />
  </Transition>
</template>

<style>
/* Заставка проявляется медленно и гаснет быстро: проснувшийся экран не ждёт */
.screensaver-enter-active {
  transition: opacity 1.5s var(--motion-easing);
}

.screensaver-leave-active {
  transition: opacity var(--motion-base) var(--motion-easing);
}

.screensaver-enter-from,
.screensaver-leave-to {
  opacity: 0;
}
</style>
