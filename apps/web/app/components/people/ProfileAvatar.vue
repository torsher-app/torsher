<script setup lang="ts">
import type { ProfileColor } from '~/lib/profiles'
import { cn } from '@/lib/utils'
import { initialOf, profileColorClass } from '~/lib/profiles'

defineProps<{
  name: string
  color: ProfileColor
  size?: 'sm' | 'md'
}>()
</script>

<template>
  <span
    :class="
      cn(
        'grid shrink-0 place-items-center font-semibold text-white',
        size === 'md'
          ? 'size-8 rounded-lg text-sm'
          : 'size-5 rounded-md text-[10.5px]',
        profileColorClass[color],
      )
    "
    aria-hidden="true"
  >
    {{ initialOf(name) }}
  </span>
</template>
