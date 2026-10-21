<script setup lang="ts">
// Раздел назывался «Раздачи»: старые закладки ведут в «Загрузки»
definePageMeta({
  redirect: to => ({ path: '/downloads', query: to.query }),
})
</script>

<template>
  <div />
</template>
