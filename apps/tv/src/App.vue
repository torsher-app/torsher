<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import AppScreensaver from './components/AppScreensaver.vue'
import TitleActions from './components/TitleActions.vue'
import { useScreensaver } from './composables/useScreensaver.ts'
import { isStacked, screenKey } from './router.ts'
import { session } from './session.ts'

// Глубже стек не помнит: экран, вытесненный из кэша, откроется с начала
const STACK_DEPTH = 10

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
    Главная, поиск, «Моё», каталог и «Источники» переживают переход дальше: по Back
    возвращаемся к тем же рядам, результатам и раздаче. Ключ по пути: «Главная»,
    «Фильмы» и «Сериалы» — отдельные экраны, как и «Каталог», «Мультфильмы» и
    «Аниме», «Источники» — свои у каждого тайтла.
    Смена профиля сбрасывает их: ряды, прогресс и язык — уже другого зрителя.

    Карточки тайтлов и персоны — отдельный стек по записям истории: по цепочке
    «актёр → фильм → режиссёр» Back возвращает каждый экран с его фокусом.
    Свой кэш с пределом: длинная цепочка не вытесняет главную и поиск.
  -->
  <RouterView v-slot="{ Component, route }">
    <KeepAlive
      :key="`screens-${cacheKey}`"
      :include="[
        'HomePage',
        'SearchPage',
        'SourcesPage',
        'MinePage',
        'CatalogPage',
      ]"
    >
      <component :is="Component" v-if="!isStacked(route)" :key="route.path" />
    </KeepAlive>
    <KeepAlive
      :key="`stack-${cacheKey}`"
      :include="['TitlePage', 'PersonPage']"
      :max="STACK_DEPTH"
    >
      <component :is="Component" v-if="isStacked(route)" :key="screenKey" />
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
