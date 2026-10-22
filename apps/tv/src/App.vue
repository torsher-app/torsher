<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { session } from './session.ts'

const currentRoute = useRoute()
const cacheKey = ref(session.profile?.id)

// Пока открыт выбор профиля, ключ стоит: иначе KeepAlive пересоздал бы и сам
// экран выбора посреди перехода дальше
watchEffect(() => {
  if (currentRoute.path !== '/profiles')
    cacheKey.value = session.profile?.id
})
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
      :include="['HomePage', 'SearchPage', 'SourcesPage']"
    >
      <component :is="Component" :key="route.path" />
    </KeepAlive>
  </RouterView>
</template>
