<script setup lang="ts">
import type { WizardCheck } from '~/lib/wizardChecks'
import { ChevronDownIcon, RefreshCwIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Card } from '@/components/ui/card'
import LoadingButton from '~/components/LoadingButton.vue'
import { checkIcons } from '~/lib/wizardChecks'

defineProps<{
  title: string
  checks: WizardCheck[]
  /** Проверка идёт: «Проверить снова» крутит спиннер */
  running?: boolean
}>()

const emit = defineEmits<{
  retry: []
}>()

const { t } = useI18n()
const opened = ref(new Set<string>())

function toggle(id: string) {
  const next = new Set(opened.value)

  if (!next.delete(id))
    next.add(id)

  opened.value = next
}
</script>

<template>
  <Card class="gap-0 overflow-hidden py-0">
    <div class="flex items-center justify-between gap-3 px-5 py-3.5">
      <h2 class="text-base font-semibold tracking-tight">
        {{ title }}
      </h2>
      <LoadingButton
        variant="outline"
        size="sm"
        :loading="running"
        @click="emit('retry')"
      >
        <RefreshCwIcon aria-hidden="true" />
        {{ t("panel.wizard.checks.retry") }}
      </LoadingButton>
    </div>
    <ul class="border-t" aria-live="polite">
      <li
        v-for="check in checks"
        :key="check.id"
        class="grid grid-cols-[16px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b px-5 py-3 last:border-b-0 sm:grid-cols-[16px_minmax(0,1fr)_auto]"
      >
        <!-- Иконка по центру первой строки заголовка: 20 px строка, 16 px иконка -->
        <component
          :is="checkIcons[check.status].icon"
          class="mt-0.5 size-4"
          :class="checkIcons[check.status].class"
          :aria-label="t(`panel.wizard.checks.status.${check.status}`)"
          role="img"
        />
        <div class="grid min-w-0 gap-0.5">
          <span class="text-sm font-medium">{{ check.title }}</span>
          <span
            v-if="check.text"
            class="text-[13px] break-words text-muted-foreground"
            :class="{ 'font-mono text-xs': check.mono }"
          >
            {{ check.text }}
          </span>
        </div>
        <!-- На телефоне — под подробностью, на десктопе — справа от заголовка -->
        <button
          v-if="check.fix"
          type="button"
          class="col-start-2 inline-flex items-center gap-1 justify-self-start rounded-sm text-[13px] leading-5 font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:col-start-3 sm:row-start-1 sm:self-start"
          :aria-expanded="opened.has(check.id)"
          :aria-controls="`check-fix-${check.id}`"
          @click="toggle(check.id)"
        >
          {{ t("panel.wizard.checks.howToFix") }}
          <ChevronDownIcon
            class="size-3.5 transition-transform"
            :class="{ 'rotate-180': opened.has(check.id) }"
            aria-hidden="true"
          />
        </button>
        <p
          v-if="check.fix"
          v-show="opened.has(check.id)"
          :id="`check-fix-${check.id}`"
          class="col-start-2 mt-0.5 rounded-md border bg-muted/50 px-3 py-2 text-[13px] text-pretty sm:col-span-2"
        >
          {{ check.fix }}
        </p>
      </li>
    </ul>
  </Card>
</template>
