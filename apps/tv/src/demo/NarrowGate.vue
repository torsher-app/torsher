<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineEmits<{ open: [] }>()

const { t } = useI18n()
</script>

<template>
  <div class="gate">
    <div class="title">
      {{ t("demo.narrowTitle") }}
    </div>
    <p>{{ t("demo.narrowText") }}</p>
    <button type="button" @click="$emit('open')">
      {{ t("demo.openAnyway") }}
    </button>
    <a href="/">{{ t("demo.backToSite") }}</a>
  </div>
</template>

<style scoped>
.gate {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 16px;
  padding: 24px;
  background: var(--color-bg);
  font-size: 16px;
  line-height: 24px;
}

.title {
  font-size: 24px;
  font-weight: 600;
  line-height: 30px;
}

p {
  margin: 0;
  color: var(--color-text-muted);
}

button {
  padding: 12px 20px;
  border: 0;
  border-radius: 12px;
  background: var(--color-text);
  color: var(--color-bg);
  font: inherit;
  font-weight: 600;
}

a {
  color: var(--color-text-muted);
  text-align: center;
}
</style>
