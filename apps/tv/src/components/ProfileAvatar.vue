<script setup lang="ts">
import type { Profile } from '@torsher/api-client'
import { computed } from 'vue'
import { initialOf } from '../lib/profiles.ts'

const props = defineProps<{ profile: Pick<Profile, 'name' | 'color'> }>()

const initial = computed(() => initialOf(props.profile.name))
</script>

<!-- Квадрат цветом профиля с буквой; размер и скругление задаёт родитель -->
<template>
  <span
    class="avatar"
    :style="{ backgroundColor: `var(--color-profile-${profile.color})` }"
    aria-hidden="true"
  >{{ initial }}</span>
</template>

<style scoped>
.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 600;
  line-height: 1;
}
</style>
