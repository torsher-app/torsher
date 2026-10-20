<script setup lang="ts">
withDefaults(defineProps<{ caption?: boolean }>(), { caption: true })
</script>

<template>
  <div class="poster-skeleton" aria-hidden="true">
    <span class="poster-skeleton__frame skeleton" />
    <template v-if="caption">
      <span
        class="poster-skeleton__line poster-skeleton__line--title skeleton"
      />
      <span
        class="poster-skeleton__line poster-skeleton__line--short skeleton"
      />
    </template>
  </div>
</template>

<style scoped>
/* Повторяет размеры PosterCard: сетка и ряды не прыгают, когда приходят данные */
.poster-skeleton {
  flex-shrink: 0;
  width: var(--poster-width);
}

.poster-skeleton__frame {
  display: block;
  padding-top: 150%;
  border-radius: var(--radius-m);
}

.poster-skeleton__line {
  display: block;
  width: 80%;
  height: var(--font-size-s);
  margin-top: calc(var(--font-size-s) * (var(--line-height) - 1));
  border-radius: var(--radius-s);
}

.poster-skeleton__line--title {
  margin-top: calc(var(--u) * 14 + var(--font-size-s) * (var(--line-height) - 1));
}

.poster-skeleton__line--short {
  width: 40%;
}
</style>
