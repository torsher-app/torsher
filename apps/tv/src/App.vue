<template>
  <!--
    Главная и поиск переживают переход в карточку: по Back возвращаемся к тем же
    рядам и результатам. Ключ по пути: «Главная», «Фильмы» и «Сериалы» — отдельные экраны.
  -->
  <RouterView v-slot="{ Component, route }">
    <KeepAlive :include="['HomePage', 'SearchPage']">
      <component :is="Component" :key="route.path" />
    </KeepAlive>
  </RouterView>
</template>
