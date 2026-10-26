<script setup lang="ts">
import type { WizardStep } from '~/composables/useWizard'
import {
  ArrowRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ExternalLinkIcon,
  MonitorSmartphoneIcon,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import PairDeviceDialog from '~/components/people/PairDeviceDialog.vue'

definePageMeta({
  layout: 'wizard',
  wizardStep: 5,
  middleware: ['required-auth', 'wizard'],
})

const { t } = useI18n()
const { wizard, finish } = useWizard()
const sources = useSources()
const network = useNetwork()
const { tvUrl } = useRuntimeConfig().public

const SECTIONS: { step: Exclude<WizardStep, 'done'>, to: string }[] = [
  { step: 'storage', to: '/settings/storage' },
  { step: 'network', to: '/settings/network' },
  { step: 'sources', to: '/sources' },
]

const isPairOpen = ref(false)
// Адрес витрины для телевизора: в продакшене её отдаёт этот же сервер
const showcaseAddress = computed(
  () => new URL(tvUrl, window.location.href).href,
)

function rowOf(step: Exclude<WizardStep, 'done'>) {
  // Источники судим по факту: менеджер мог подключиться и при пропуске шага
  if (step === 'sources') {
    const count = sources.indexers.value.length

    if (count > 0)
      return { done: true, text: t('panel.wizard.sources.indexers', count) }

    return {
      done: false,
      text: t(
        wizard.value?.skipped.includes(step)
          ? 'panel.wizard.done.skipped'
          : 'panel.wizard.done.noSources',
      ),
    }
  }

  if (wizard.value?.skipped.includes(step))
    return { done: false, text: t('panel.wizard.done.skipped') }

  // Сеть тоже по факту: шаг проходят и с недоступным TMDB, а витрина тогда пуста
  if (step === 'network') {
    const tmdb = (network.check.value?.hosts ?? []).filter(
      host => host.kind === 'tmdb' || host.kind === 'tmdb_images',
    )

    if (tmdb.some(host => host.status && host.status !== 'ok'))
      return { done: false, text: t('panel.wizard.done.noCatalog') }
  }

  return { done: true, text: t(`panel.wizard.done.${step}`) }
}

const rows = computed(() =>
  SECTIONS.map(({ step, to }) => ({ step, to, ...rowOf(step) })),
)

onMounted(() => {
  // Ошибка сохранения не держит владельца: тост покажет API-клиент
  finish().catch(() => undefined)
  sources.ensureLoaded()
  network.load()
})
</script>

<template>
  <header>
    <h1 class="text-2xl font-semibold tracking-tight text-balance">
      {{ t("panel.wizard.done.title") }}
    </h1>
    <p class="mt-1.5 max-w-[58ch] text-muted-foreground">
      {{ t("panel.wizard.done.text") }}
    </p>
  </header>

  <Card class="gap-0 overflow-hidden py-0">
    <ul>
      <li
        v-for="row in rows"
        :key="row.step"
        class="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-3 border-b px-5 py-3 last:border-b-0"
      >
        <component
          :is="row.done ? CircleCheckIcon : CircleDashedIcon"
          class="size-4"
          :class="row.done ? 'text-success' : 'text-muted-foreground'"
          :aria-label="
            t(row.done ? 'panel.wizard.done.ready' : 'panel.wizard.done.later')
          "
          role="img"
        />
        <span class="grid min-w-0 gap-0.5">
          <span class="text-sm font-medium">
            {{ t(`panel.wizard.steps.${row.step}.title`) }}
          </span>
          <span class="text-[13px] text-muted-foreground">{{ row.text }}</span>
        </span>
        <Button variant="ghost" size="sm" as-child>
          <NuxtLink :to="row.to">
            {{
              t(
                row.done
                  ? "panel.wizard.done.change"
                  : "panel.wizard.done.setUp",
              )
            }}
          </NuxtLink>
        </Button>
      </li>
    </ul>
  </Card>

  <Card class="gap-3 p-5">
    <div class="flex items-start gap-3">
      <MonitorSmartphoneIcon
        class="mt-0.5 size-4 shrink-0"
        aria-hidden="true"
      />
      <div class="grid gap-1">
        <h2 class="text-base font-semibold tracking-tight">
          {{ t("panel.wizard.done.deviceTitle") }}
        </h2>
        <p class="text-[13.5px] text-pretty text-muted-foreground">
          {{ t("panel.wizard.done.deviceText") }}
        </p>
        <code class="mt-1 font-mono text-[12.5px] break-all">{{
          showcaseAddress
        }}</code>
      </div>
    </div>
    <div class="flex flex-wrap gap-2 pl-7">
      <Button variant="outline" size="sm" @click="isPairOpen = true">
        {{ t("panel.people.pair.title") }}
      </Button>
      <Button variant="ghost" size="sm" as-child>
        <NuxtLink to="/people">
          {{ t("panel.wizard.done.people") }}
        </NuxtLink>
      </Button>
    </div>
  </Card>

  <div
    class="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-end"
  >
    <Button variant="outline" class="w-full sm:w-auto" as-child>
      <a :href="tvUrl" target="_blank" rel="noopener">
        {{ t("panel.wizard.done.openShowcase") }}
        <ExternalLinkIcon aria-hidden="true" />
      </a>
    </Button>
    <Button class="w-full sm:w-auto" as-child>
      <NuxtLink to="/">
        {{ t("panel.wizard.done.toPanel") }}
        <ArrowRightIcon aria-hidden="true" />
      </NuxtLink>
    </Button>
  </div>

  <PairDeviceDialog v-model:open="isPairOpen" />
</template>
