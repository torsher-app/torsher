<script setup lang="ts">
import { CheckIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import BrandMark from '~/components/shell/BrandMark.vue'

const STEPS = ['account', 'storage', 'network', 'sources', 'done'] as const

const { t } = useI18n()
const route = useRoute()

// Номер шага задаёт страница через definePageMeta({ wizardStep })
const current = computed(() => Number(route.meta.wizardStep ?? 1))

// Прокрутка живёт в <main> оболочки, а не в окне: новый шаг начинается сверху
const content = useTemplateRef('content')

watch(
  () => route.path,
  () => content.value?.scrollTo({ top: 0 }),
)
</script>

<template>
  <div class="flex h-svh flex-col bg-sidebar md:flex-row">
    <aside class="hidden w-75 shrink-0 flex-col gap-5.5 px-4 py-5.5 md:flex">
      <div class="flex items-center gap-2.5 px-2 py-1">
        <BrandMark class="size-5.5 shrink-0" />
        <span class="grid leading-tight">
          <span class="text-base font-semibold tracking-tight">Torsher</span>
          <span class="text-xs text-muted-foreground">{{
            t("panel.wizard.label")
          }}</span>
        </span>
      </div>
      <ol class="grid gap-0.5">
        <li
          v-for="(step, index) in STEPS"
          :key="step"
          :aria-current="index + 1 === current ? 'step' : undefined"
          :class="
            cn(
              'flex items-start gap-3 rounded-lg p-2.5',
              index + 1 === current
                && 'bg-background shadow-[0_0_0_1px_var(--border)]',
            )
          "
        >
          <span
            :class="
              cn(
                'grid size-6 shrink-0 place-items-center rounded-full border border-input bg-background text-xs font-semibold text-muted-foreground tabular-nums',
                index + 1 < current
                  && 'border-transparent bg-primary text-primary-foreground',
                index + 1 === current
                  && 'border-primary text-foreground ring-3 ring-brand/25',
              )
            "
          >
            <CheckIcon
              v-if="index + 1 < current"
              class="size-3.5"
              aria-hidden="true"
            />
            <template v-else>{{ index + 1 }}</template>
          </span>
          <span class="grid gap-px">
            <span
              class="text-sm font-medium"
              :class="{ 'text-muted-foreground': index + 1 > current }"
            >
              {{ t(`panel.wizard.steps.${step}.title`) }}
            </span>
            <span class="text-[12.5px] text-muted-foreground">
              {{ t(`panel.wizard.steps.${step}.text`) }}
            </span>
          </span>
        </li>
      </ol>
      <p class="mt-auto px-2.5 text-[12.5px] text-muted-foreground">
        {{ t("panel.wizard.note") }}
      </p>
    </aside>

    <!-- На телефоне вместо списка шагов — «Шаг 1 из 5» и полоса прогресса -->
    <div class="grid gap-2.5 border-b bg-background px-4 pt-3.5 pb-3 md:hidden">
      <div
        class="flex items-center justify-between text-[13px] text-muted-foreground"
      >
        <span class="flex items-center gap-2 font-semibold text-foreground">
          <BrandMark class="size-4.5" />
          Torsher
        </span>
        <span class="tabular-nums">
          {{
            t("panel.wizard.stepOf", {
              n: current,
              total: STEPS.length,
              step: t(`panel.wizard.steps.${STEPS[current - 1]}.title`),
            })
          }}
        </span>
      </div>
      <Progress
        :model-value="(current / STEPS.length) * 100"
        class="h-1 bg-accent *:data-[slot=progress-indicator]:bg-brand"
        :aria-label="t('panel.wizard.label')"
      />
    </div>

    <main
      ref="content"
      class="min-h-0 flex-1 overflow-y-auto bg-background md:my-2 md:mr-2 md:rounded-xl md:border"
    >
      <div
        class="mx-auto grid max-w-160 gap-5.5 px-4 pt-6 pb-8 md:px-10 md:py-14"
      >
        <slot />
      </div>
    </main>
  </div>
</template>
