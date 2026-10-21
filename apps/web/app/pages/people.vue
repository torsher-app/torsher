<script setup lang="ts">
import PeopleView from '~/components/people/PeopleView.vue'

definePageMeta({
  middleware: 'required-auth',
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PeopleView />
  </div>
</template>
