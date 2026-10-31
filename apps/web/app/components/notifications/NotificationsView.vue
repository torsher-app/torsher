<script setup lang="ts">
import type { NotificationItem } from '@torsher/api-client'
import { getErrorMessage } from '@torsher/api-client'
import {
  BellIcon,
  CheckCheckIcon,
  CircleAlertIcon,
  RefreshCwIcon,
  Settings2Icon,
} from '@lucide/vue'
import { useNow } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import ListGroup from '~/components/ListGroup.vue'
import LoadingButton from '~/components/LoadingButton.vue'
import PageBar from '~/components/shell/PageBar.vue'
import { dayKeyOf, formatLogDay } from '~/lib/logs'
import NotificationRow from './NotificationRow.vue'
import NotificationsFilters from './NotificationsFilters.vue'

const { t, locale } = useI18n()
const { group, unreadOnly, resetFilters } = useNotificationsQuery()
const feed = useNotificationFeed(() => ({
  group: group.value,
  unread: unreadOnly.value,
}))
const { unread, items, hasMore, state, isLoadingMore } = feed
const now = useNow({ interval: 60_000 })

// Время скелетона идёт от открытия страницы или смены фильтра
const loading = useHeldLoading(
  () => state.value === 'loading' || state.value === 'idle',
)

const groups = computed(() => {
  const today = now.value
  const yesterday = new Date(today)

  yesterday.setDate(today.getDate() - 1)

  const todayKey = dayKeyOf(today)
  const yesterdayKey = dayKeyOf(yesterday)
  const result: { key: string, title: string, items: NotificationItem[] }[]
    = []

  for (const item of items.value) {
    const date = new Date(item.createdAt)
    const key = dayKeyOf(date)
    let day = result.at(-1)

    if (day?.key !== key) {
      day = {
        key,
        title:
          key === todayKey
            ? t('panel.logs.groups.today')
            : key === yesterdayKey
              ? t('panel.logs.groups.yesterday')
              : formatLogDay(date, locale.value, today),
        items: [],
      }
      result.push(day)
    }

    day.items.push(item)
  }

  return result
})

const emptyFilter = computed(() => {
  const name = group.value
    ? t(`panel.notifications.feed.groups.${group.value}`)
    : ''

  if (group.value && unreadOnly.value)
    return t('panel.notifications.feed.nothingUnreadInGroup', { group: name })

  if (group.value)
    return t('panel.notifications.feed.nothingInGroup', { group: name })

  return t('panel.notifications.feed.nothingUnread')
})

async function onLoadMore() {
  try {
    await feed.loadMore()
  }
  catch (err) {
    toast.error(t('panel.notifications.feed.loadMoreFailed'), {
      description: await getErrorMessage(err),
    })
  }
}

function onOpen(id: string) {
  // Ошибку запроса показывает тостом клиент API
  feed.markRead(id).catch(() => {})
}

function onReadAll() {
  feed.markAllRead().catch(() => {})
}

// Прошлый список не подходит к новому фильтру: на его месте скелетон
watch([group, unreadOnly], () => feed.load({ reset: true }))

onMounted(() => feed.load())
</script>

<template>
  <PageBar :title="t('panel.notifications.title')">
    <template #actions>
      <Button
        variant="ghost"
        size="sm"
        :disabled="!unread"
        :aria-label="t('panel.notifications.readAll')"
        @click="onReadAll"
      >
        <CheckCheckIcon aria-hidden="true" />
        <span class="hidden md:inline">{{
          t("panel.notifications.readAll")
        }}</span>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        as-child
        :aria-label="t('panel.notifications.settings')"
      >
        <NuxtLink to="/settings/notifications">
          <Settings2Icon />
        </NuxtLink>
      </Button>
    </template>
  </PageBar>

  <NotificationsFilters
    :unread-count="state === 'ready' ? unread : undefined"
  />

  <div class="min-h-0 flex-1 overflow-y-auto">
    <!-- Скелетон — заголовок дня и строки той же сетки, что строки списка -->
    <div v-if="loading" aria-busy="true">
      <div class="flex min-h-9 items-center border-b bg-muted px-4">
        <Skeleton class="h-3 w-24" />
      </div>
      <div
        v-for="row in 6"
        :key="row"
        class="grid grid-cols-[16px_minmax(0,1fr)] gap-x-3 border-b px-4 py-3"
      >
        <Skeleton class="mt-px size-4 rounded-full" />
        <span class="grid gap-1.5">
          <Skeleton class="h-4 w-2/5" />
          <Skeleton class="h-3 w-3/5" />
          <Skeleton class="h-3 w-10" />
        </span>
      </div>
    </div>

    <section
      v-else-if="state === 'error'"
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
        {{ t("panel.notifications.loadError") }}
      </h2>
      <Button variant="outline" class="mt-1" @click="feed.load()">
        <RefreshCwIcon aria-hidden="true" />
        {{ t("panel.common.retry") }}
      </Button>
    </section>

    <!-- Пустой фильтр и пустая лента — разные тексты и действия -->
    <section
      v-else-if="!items.length"
      class="mx-auto grid max-w-140 justify-items-center gap-3.5 px-4 pt-[12vh] pb-8 text-center"
    >
      <template v-if="group || unreadOnly">
        <p class="text-muted-foreground">
          {{ emptyFilter }}
        </p>
        <Button variant="outline" size="sm" @click="resetFilters">
          {{ t("panel.notifications.feed.showAll") }}
        </Button>
      </template>
      <template v-else>
        <div
          class="grid size-11 place-items-center rounded-xl border bg-muted"
          aria-hidden="true"
        >
          <BellIcon class="size-5" />
        </div>
        <h2 class="text-base font-semibold">
          {{ t("panel.notifications.feed.emptyTitle") }}
        </h2>
        <p class="max-w-[52ch] text-pretty text-muted-foreground">
          {{ t("panel.notifications.feed.emptyText") }}
        </p>
      </template>
    </section>

    <template v-else>
      <section v-for="day in groups" :key="day.key" :aria-label="day.title">
        <ListGroup :title="day.title" />
        <ul>
          <li v-for="item in day.items" :key="item.id" class="border-b">
            <NotificationRow
              :item="item"
              :now="now.getTime()"
              time-format="clock"
              @open="onOpen(item.id)"
            />
          </li>
        </ul>
      </section>
      <div v-if="hasMore" class="flex justify-center p-4">
        <LoadingButton
          variant="outline"
          size="sm"
          :loading="isLoadingMore"
          @click="onLoadMore"
        >
          {{ t("panel.notifications.more") }}
        </LoadingButton>
      </div>
    </template>
  </div>
</template>
