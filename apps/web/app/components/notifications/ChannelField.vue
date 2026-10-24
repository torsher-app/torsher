<script setup lang="ts">
import { useField } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import SecretInput from '~/components/SecretInput.vue'

const props = defineProps<{
  // Поле настроек канала: путь в форме — `config.<name>`
  name: string
  label: string
  hint?: string
  placeholder?: string
  secret?: boolean
  // Секрет уже сохранён: пустое поле оставляет его как есть
  saved?: boolean
  // Сохранённый секрет можно удалить: он необязательный
  removable?: boolean
  // Адрес назначения изменился: сохранённый секрет не перенесётся
  moved?: boolean
  mono?: boolean
  type?: 'text' | 'email' | 'url' | 'number'
  autocomplete?: string
  options?: { value: string, label: string }[]
}>()

// Сохранённый секрет удалят при сохранении
const cleared = defineModel<boolean>('cleared', { default: false })

const { t } = useI18n()
const { value, errorMessage, handleBlur } = useField<string>(
  () => `config.${props.name}`,
)
const id = computed(() => `channel-${props.name}`)
const keepsSaved = computed(
  () => props.saved && !props.moved && !cleared.value,
)

// Введённое значение заменяет секрет, а не удаляет его
watch(value, (next) => {
  if (next?.trim())
    cleared.value = false
})
</script>

<template>
  <div class="grid gap-2">
    <Label :for="id">{{ label }}</Label>
    <Select v-if="options" v-model="value">
      <SelectTrigger :id="id" class="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem
          v-for="option in options"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </SelectItem>
      </SelectContent>
    </Select>
    <SecretInput
      v-else-if="secret"
      :id="id"
      v-model="value"
      :class="mono && 'font-mono'"
      :placeholder="
        keepsSaved ? t('panel.notifications.dialog.savedSecret') : placeholder
      "
      :aria-invalid="Boolean(errorMessage)"
      autocomplete="off"
      :show-label="t('panel.common.showKey')"
      :hide-label="t('panel.common.hideKey')"
      @blur="handleBlur"
    />
    <Input
      v-else
      :id="id"
      v-model="value"
      :type="type ?? 'text'"
      :class="mono && 'font-mono'"
      :placeholder="placeholder"
      :autocomplete="autocomplete ?? 'off'"
      :aria-invalid="Boolean(errorMessage)"
      @blur="handleBlur"
    />
    <p v-if="errorMessage" class="text-[12.5px] text-destructive">
      {{ errorMessage }}
    </p>
    <p v-else-if="saved && moved" class="text-[12.5px] text-muted-foreground">
      {{ t("panel.notifications.dialog.movedSecretHint") }}
    </p>
    <!-- Подсказка и кнопка в одну строку: смена состояния не сдвигает форму -->
    <p
      v-else-if="saved"
      class="flex items-center gap-2 text-[12.5px] text-muted-foreground"
    >
      <span class="min-w-0 truncate">
        {{
          t(
            cleared
              ? "panel.notifications.dialog.clearedSecretHint"
              : "panel.notifications.dialog.savedSecretHint",
          )
        }}
      </span>
      <Button
        v-if="removable"
        type="button"
        variant="link"
        size="xs"
        class="h-auto shrink-0 p-0 text-[12.5px]"
        @click="cleared = !cleared"
      >
        {{
          t(
            cleared
              ? "panel.notifications.dialog.restoreSecret"
              : "panel.notifications.dialog.removeSecret",
          )
        }}
      </Button>
    </p>
    <p v-else-if="hint" class="text-[12.5px] text-muted-foreground">
      {{ hint }}
    </p>
    <slot />
  </div>
</template>
