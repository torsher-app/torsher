<script setup lang="ts">
import { Toaster } from '@/components/ui/sonner'
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <NuxtPage />
    <Toaster position="top-right" />
  </div>
</template>
