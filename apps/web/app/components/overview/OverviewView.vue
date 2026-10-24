<script setup lang="ts">
import { CircleAlertIcon, RefreshCwIcon } from '@lucide/vue'
import { useNow } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import PageBar from '~/components/shell/PageBar.vue'
import { uptimeOf } from '~/lib/overview'
import OverviewAttention from './OverviewAttention.vue'
import OverviewTiles from './OverviewTiles.vue'
import OverviewUpdate from './OverviewUpdate.vue'

const { t } = useI18n()
const { overview, state, load, refresh } = useOverview()

useOverviewPolling()

const now = useNow({ interval: 60_000 })

const meta = computed(() => {
  const value = overview.value

  if (!value)
    return ''

  const uptime = uptimeOf(value.startedAt, now.value.getTime())

  return [
    t(`panel.overview.uptime.${uptime.unit}`, uptime.value),
    t('panel.overview.version', { version: value.version }),
  ].join(' · ')
})
</script>

<template>
  <PageBar :title="t('panel.overview.title')" :parent="t('panel.nav.server')">
    <template v-if="meta" #actions>
      <!-- На телефоне шапке не хватит места: строка уходит под заголовок -->
      <span
        class="hidden px-1 text-[13px] text-muted-foreground tabular-nums sm:inline"
      >
        {{ meta }}
      </span>
    </template>
  </PageBar>

  <div class="min-h-0 flex-1 overflow-y-auto">
    <!-- Тот же контейнер, что у настроек: заголовки стоят на одной линии -->
    <div class="mx-auto grid w-full max-w-5xl gap-5 px-4 py-5 lg:px-8 lg:py-7">
      <header>
        <h1 class="text-[22px] font-semibold tracking-tight">
          {{ t("panel.overview.title") }}
        </h1>
        <p class="mt-1 text-muted-foreground">
          {{ t("panel.overview.description") }}
        </p>
        <p
          v-if="meta"
          class="mt-1 text-[13px] text-muted-foreground tabular-nums sm:hidden"
        >
          {{ meta }}
        </p>
      </header>

      <!-- Скелетон повторяет сетку плиток -->
      <div
        v-if="state === 'loading' || state === 'idle'"
        class="grid gap-4 sm:grid-cols-2"
        aria-busy="true"
      >
        <Skeleton v-for="index in 6" :key="index" class="h-36 rounded-xl" />
      </div>

      <section
        v-else-if="state === 'error' || !overview"
        class="grid justify-items-center gap-3.5 rounded-xl border px-4 py-10 text-center"
        role="alert"
      >
        <div
          class="grid size-11 place-items-center rounded-xl border bg-muted text-destructive"
          aria-hidden="true"
        >
          <CircleAlertIcon class="size-5" />
        </div>
        <h2 class="text-base font-semibold">
          {{ t("panel.overview.loadError") }}
        </h2>
        <p class="text-muted-foreground">
          {{ t("panel.overview.loadErrorText") }}
        </p>
        <Button variant="outline" @click="load">
          <RefreshCwIcon aria-hidden="true" />
          {{ t("panel.common.retry") }}
        </Button>
      </section>

      <template v-else>
        <OverviewUpdate
          v-if="overview.update"
          :update="overview.update"
          @dismissed="refresh"
        />
        <OverviewAttention
          v-if="overview.attention.length"
          :items="overview.attention"
        />
        <OverviewTiles :overview="overview" />
      </template>
    </div>
  </div>
</template>
