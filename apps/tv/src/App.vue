<template>
  <!-- Поиск переживает переход в карточку: по Back возвращаемся к тем же результатам -->
  <RouterView v-slot="{ Component }">
    <KeepAlive include="SearchPage">
      <component :is="Component" />
    </KeepAlive>
  </RouterView>
</template>
