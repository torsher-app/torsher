<script setup lang="ts">
import type { WizardStep } from '~/composables/useWizard'
import { ArrowRightIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import LoadingButton from '~/components/LoadingButton.vue'

const props = defineProps<{
  step: WizardStep
  /** Подпись «Дальше»: при ошибке проверки она называет последствие */
  nextLabel?: string
}>()

const { t } = useI18n()
const { next, skip, skipAll } = useWizard()

const pending = ref<'next' | 'skip' | 'later' | null>(null)

async function run(action: 'next' | 'skip' | 'later') {
  pending.value = action

  try {
    if (action === 'next')
      await next(props.step)
    else if (action === 'skip')
      await skip(props.step)
    else await skipAll(props.step)
  }
  finally {
    pending.value = null
  }
}
</script>

<template>
  <div
    class="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:items-center"
  >
    <Button
      variant="link"
      class="px-0 text-muted-foreground sm:mr-auto"
      :disabled="!!pending"
      @click="run('later')"
    >
      {{ t("panel.wizard.actions.later") }}
    </Button>
    <LoadingButton
      variant="outline"
      class="w-full sm:w-auto"
      :loading="pending === 'skip'"
      :disabled="!!pending"
      @click="run('skip')"
    >
      {{ t("panel.wizard.actions.skip") }}
    </LoadingButton>
    <LoadingButton
      class="w-full sm:w-auto"
      :loading="pending === 'next'"
      :disabled="!!pending"
      @click="run('next')"
    >
      {{ nextLabel ?? t("panel.wizard.actions.next") }}
      <ArrowRightIcon aria-hidden="true" />
    </LoadingButton>
  </div>
</template>
