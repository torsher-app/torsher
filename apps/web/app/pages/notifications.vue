<script setup lang="ts">
import NotificationsView from '~/components/notifications/NotificationsView.vue'

definePageMeta({
  middleware: 'required-auth',
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <NotificationsView />
  </div>
</template>
