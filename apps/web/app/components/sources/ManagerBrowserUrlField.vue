<script setup lang="ts">
import { useField } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const { t } = useI18n()
const { value, errorMessage, handleBlur } = useField<string>('browserUrl')
</script>

<template>
  <div class="grid gap-2">
    <Label for="manager-browser-url">{{
      t("panel.sources.browserUrl.label")
    }}</Label>
    <Input
      id="manager-browser-url"
      v-model="value"
      type="url"
      inputmode="url"
      autocomplete="off"
      class="font-mono"
      placeholder="https://manager.example"
      :aria-invalid="!!errorMessage || undefined"
      aria-describedby="manager-browser-url-hint"
      @blur="handleBlur"
    />
    <p
      id="manager-browser-url-hint"
      class="text-[12.5px]"
      :class="errorMessage ? 'text-destructive' : 'text-muted-foreground'"
    >
      {{ errorMessage || t("panel.sources.browserUrl.hint") }}
    </p>
  </div>
</template>
