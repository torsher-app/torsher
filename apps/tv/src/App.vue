<template>
  <!--
    Главная, поиск и «Источники» переживают переход дальше: по Back возвращаемся к
    тем же рядам, результатам и раздаче. Ключ по пути: «Главная», «Фильмы» и
    «Сериалы» — отдельные экраны, «Источники» — свои у каждого тайтла.
  -->
  <RouterView v-slot="{ Component, route }">
    <KeepAlive :include="['HomePage', 'SearchPage', 'SourcesPage']">
      <component :is="Component" :key="route.path" />
    </KeepAlive>
  </RouterView>
</template>
