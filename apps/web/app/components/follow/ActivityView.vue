<script setup lang="ts">
import type { BlocklistItem } from '@torsher/api-client'
import { getErrorMessage } from '@torsher/api-client'
import {
  BanIcon,
  CircleAlertIcon,
  HistoryIcon,
  ListEndIcon,
  RefreshCwIcon,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import ListGroup from '~/components/ListGroup.vue'
import LoadingButton from '~/components/LoadingButton.vue'
import PageBar from '~/components/shell/PageBar.vue'
import { dayKeyOf, formatLogDay } from '~/lib/logs'
import ActivityFilters from './ActivityFilters.vue'
import ActivityRow from './ActivityRow.vue'
import BlocklistRow from './BlocklistRow.vue'
import QueueRow from './QueueRow.vue'

const { t, locale } = useI18n()
const { tab, follow, kind, resetFilters } = useActivityQuery()
const followsStore = useFollows()
const queue = useFollowQueue()
const history = useFollowHistory({ follow, kind })
const blocklist = useFollowBlocklist()

const EMPTY_ICONS = {
  queue: ListEndIcon,
  history: HistoryIcon,
  blocklist: BanIcon,
}

const followTitleId = computed(
  () =>
    followsStore.follows.value.find(item => item.id === follow.value)
      ?.titleId,
)

const queueItems = computed(() =>
  follow.value
    ? queue.items.value.filter(item => item.followId === follow.value)
    : queue.items.value,
)

// У записи чёрного списка нет слежения: фильтр — по тайтлу
const blockItems = computed(() =>
  follow.value
    ? blocklist.items.value.filter(
        item => item.titleId === followTitleId.value,
      )
    : blocklist.items.value,
)

const historyGroups = computed(() => {
  const today = new Date()
  const yesterday = new Date(today)

  yesterday.setDate(today.getDate() - 1)

  const todayKey = dayKeyOf(today)
  const yesterdayKey = dayKeyOf(yesterday)
  const groups: {
    key: string
    title: string
    items: typeof history.items.value
  }[] = []

  for (const item of history.items.value) {
    const date = new Date(item.at)
    const key = dayKeyOf(date)
    let group = groups.at(-1)

    if (group?.key !== key) {
      group = {
        key,
        title:
          key === todayKey
            ? t('panel.logs.groups.today')
            : key === yesterdayKey
              ? t('panel.logs.groups.yesterday')
              : formatLogDay(date, locale.value, today),
        items: [],
      }
      groups.push(group)
    }

    group.items.push(item)
  }

  return groups
})

const current = computed(() => {
  if (tab.value === 'queue') {
    return {
      state: queue.state.value,
      count: queueItems.value.length,
      retry: queue.load,
    }
  }

  if (tab.value === 'history') {
    return {
      state: history.state.value,
      count: history.items.value.length,
      retry: history.load,
    }
  }

  return {
    state: blocklist.state.value,
    count: blockItems.value.length,
    retry: blocklist.load,
  }
})

// Время скелетона идёт от смены вкладки или фильтра
const loading = useHeldLoading(
  () => current.value.state === 'loading' || current.value.state === 'idle',
)

const counts = computed(() => ({
  queue: queue.state.value === 'ready' ? queueItems.value.length : undefined,
  blocklist:
    blocklist.state.value === 'ready' ? blockItems.value.length : undefined,
}))

const hasFilter = computed(
  () => !!follow.value || (tab.value === 'history' && !!kind.value),
)

async function onLoadMore() {
  try {
    await history.loadMore()
  }
  catch (err) {
    toast.error(t('panel.follow.activity.loadMoreFailed'), {
      description: await getErrorMessage(err),
    })
  }
}

async function onAnswer(id: string, confirm: boolean) {
  try {
    await history.answer(id, confirm)
    toast.success(
      t(
        confirm
          ? 'panel.follow.unsure.confirmed'
          : 'panel.follow.unsure.dismissed',
      ),
    )
  }
  catch {
    // Тост ошибки показал клиент API
  }
}

async function onUnblock(item: BlocklistItem) {
  try {
    await blocklist.remove(item.id)
    toast.success(t('panel.follow.blocklist.removed'), {
      description: item.releaseTitle,
    })
  }
  catch {
    // Тост ошибки показал клиент API
  }
}

// История зависит от фильтров сервера, очередь и список фильтруются на месте
watch([tab, follow, kind], ([nextTab], [prevTab]) => {
  if (nextTab === 'history')
    void history.load()
  else if (nextTab !== prevTab && nextTab === 'blocklist')
    void blocklist.load()
})

onMounted(() => {
  void followsStore.ensureLoaded()
  void queue.load()
  void blocklist.load()

  if (tab.value === 'history')
    void history.load()
})
onBeforeUnmount(queue.stop)
</script>

<template>
  <PageBar
    :title="t('panel.follow.activity.title')"
    :parent="t('panel.follow.title')"
    parent-to="/follow"
  />

  <ActivityFilters :counts="counts" />

  <div class="min-h-0 flex-1 overflow-y-auto">
    <!-- Скелетон повторяет строки своей вкладки той же высоты -->
    <div v-if="loading" aria-busy="true">
      <div
        v-if="tab === 'history'"
        class="flex min-h-9 items-center border-b bg-muted px-4"
      >
        <Skeleton class="h-3 w-24" />
      </div>
      <template v-if="tab === 'queue'">
        <div
          v-for="row in 4"
          :key="row"
          class="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3 border-b py-2.5 pr-4 pl-4 md:h-14 md:py-0"
        >
          <Skeleton class="h-10 w-7 rounded" />
          <div class="grid gap-1.5">
            <Skeleton class="h-3.5 w-2/5" />
            <Skeleton class="h-3 w-3/5" />
          </div>
        </div>
      </template>
      <template v-else-if="tab === 'history'">
        <div
          v-for="row in 6"
          :key="row"
          class="grid grid-cols-[40px_16px_minmax(0,1fr)] items-start gap-x-3 border-b py-2.5 pr-4 pl-4"
        >
          <Skeleton class="mt-1 h-3 w-9" />
          <Skeleton class="mt-0.5 size-4 rounded-full" />
          <div class="grid gap-1.5 pt-0.5">
            <Skeleton class="h-3.5 w-3/5" />
            <Skeleton class="h-3 w-2/5" />
          </div>
        </div>
      </template>
      <template v-else>
        <div
          v-for="row in 3"
          :key="row"
          class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b py-2.5 pr-2.5 pl-4"
        >
          <div class="grid gap-1.5">
            <Skeleton class="h-3.5 w-2/5" />
            <Skeleton class="h-3 w-3/5" />
          </div>
          <Skeleton class="h-8 w-32" />
        </div>
      </template>
    </div>

    <section
      v-else-if="current.state === 'error'"
      class="mx-auto grid max-w-130 justify-items-center gap-3.5 px-4 pt-[12vh] pb-8 text-center"
      role="alert"
    >
      <div
        class="grid size-11 place-items-center rounded-xl border bg-muted text-destructive"
        aria-hidden="true"
      >
        <CircleAlertIcon class="size-5" />
      </div>
      <h2 class="text-base font-semibold">
        {{ t(`panel.follow.activity.loadError.${tab}`) }}
      </h2>
      <p class="text-muted-foreground">
        {{ t("panel.follow.loadErrorText") }}
      </p>
      <Button variant="outline" class="mt-1" @click="current.retry">
        <RefreshCwIcon aria-hidden="true" />
        {{ t("panel.common.retry") }}
      </Button>
    </section>

    <!-- Пустой фильтр и пустая вкладка — разные тексты и действия -->
    <section
      v-else-if="current.count === 0"
      class="mx-auto grid max-w-140 justify-items-center gap-3.5 px-4 pt-[12vh] pb-8 text-center"
    >
      <template v-if="hasFilter">
        <p class="text-muted-foreground">
          {{ t("panel.follow.activity.nothingFiltered") }}
        </p>
        <Button variant="outline" size="sm" @click="resetFilters">
          {{ t("panel.follow.filters.reset") }}
        </Button>
      </template>
      <template v-else>
        <div
          class="grid size-11 place-items-center rounded-xl border bg-muted"
          aria-hidden="true"
        >
          <component :is="EMPTY_ICONS[tab]" class="size-5" />
        </div>
        <h2 class="text-base font-semibold">
          {{ t(`panel.follow.activity.empty.${tab}.title`) }}
        </h2>
        <p class="max-w-[52ch] text-pretty text-muted-foreground">
          {{ t(`panel.follow.activity.empty.${tab}.text`) }}
        </p>
      </template>
    </section>

    <ul v-else-if="tab === 'queue'">
      <QueueRow
        v-for="item in queueItems"
        :key="`${item.kind}:${item.followId}:${item.season}:${item.episodes[0]}`"
        :item="item"
      />
    </ul>

    <template v-else-if="tab === 'history'">
      <section
        v-for="group in historyGroups"
        :key="group.key"
        :aria-label="group.title"
      >
        <ListGroup :title="group.title" />
        <ul>
          <ActivityRow
            v-for="item in group.items"
            :key="item.id"
            :item="item"
            :answering="history.answering.value === item.id"
            @answer="(confirm) => onAnswer(item.id, confirm)"
          />
        </ul>
      </section>
      <div v-if="history.hasMore.value" class="flex justify-center p-4">
        <LoadingButton
          variant="outline"
          size="sm"
          :loading="history.isLoadingMore.value"
          @click="onLoadMore"
        >
          {{ t("panel.follow.activity.loadMore") }}
        </LoadingButton>
      </div>
    </template>

    <ul v-else>
      <BlocklistRow
        v-for="item in blockItems"
        :key="item.id"
        :item="item"
        :removing="blocklist.removing.value === item.id"
        :disabled="!!blocklist.removing.value"
        @remove="onUnblock(item)"
      />
    </ul>
  </div>
</template>
