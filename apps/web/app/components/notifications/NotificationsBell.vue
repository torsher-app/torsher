<script setup lang="ts">
import { BellIcon, CircleAlertIcon, RefreshCwIcon } from '@lucide/vue'
import { useNow } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { BELL_SIZE } from '~/composables/useNotifications'
import NotificationRow from './NotificationRow.vue'

const { t } = useI18n()
const { unread, items, hasMore, state, load, markRead, markAllRead }
  = useNotifications()

useUnreadPolling()

const open = ref(false)
// Время скелетона идёт от открытия поповера, а не от монтирования колокола
const loading = useHeldLoading(
  () => open.value && (state.value === 'loading' || state.value === 'idle'),
)
const now = useNow({ interval: 60_000 })

const badge = computed(() => (unread.value > 9 ? '9+' : String(unread.value)))

watch(open, (isOpen) => {
  if (isOpen)
    void load()
})

function onOpenItem(id: string) {
  open.value = false
  markRead(id).catch(() => {})
}

function onReadAll() {
  // Ошибку запроса показывает тостом клиент API
  markAllRead().catch(() => {})
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        size="icon-sm"
        class="relative"
        :aria-label="
          unread
            ? t('panel.notifications.bellUnread', { n: unread }, unread)
            : t('panel.notifications.title')
        "
      >
        <BellIcon />
        <!-- Счётчик поверх иконки: появление числа ничего не сдвигает в шапке -->
        <span
          v-if="unread"
          class="pointer-events-none absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground tabular-nums"
          aria-hidden="true"
        >{{ badge }}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent
      align="end"
      class="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0"
    >
      <header
        class="flex h-11 items-center justify-between gap-3 border-b px-4"
      >
        <h2 class="text-[14px] font-semibold">
          {{ t("panel.notifications.title") }}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          class="-mr-2 h-7 text-[12.5px]"
          :disabled="!unread"
          @click="onReadAll"
        >
          {{ t("panel.notifications.readAll") }}
        </Button>
      </header>

      <div class="max-h-[min(28rem,60dvh)] overflow-y-auto">
        <!-- Скелетон строк той же высоты, что строки списка -->
        <div v-if="loading" class="divide-y" aria-busy="true">
          <div
            v-for="index in 3"
            :key="index"
            class="grid grid-cols-[16px_minmax(0,1fr)] gap-x-3 px-4 py-3"
          >
            <Skeleton class="mt-px size-4 rounded-full" />
            <span class="grid gap-1.5">
              <Skeleton class="h-4 w-4/5" />
              <Skeleton class="h-3 w-16" />
            </span>
          </div>
        </div>

        <div
          v-else-if="state === 'error'"
          class="grid justify-items-center gap-2.5 px-4 py-8 text-center"
          role="alert"
        >
          <CircleAlertIcon class="size-5 text-destructive" aria-hidden="true" />
          <p class="text-[13.5px] text-muted-foreground">
            {{ t("panel.notifications.loadError") }}
          </p>
          <Button variant="outline" size="sm" @click="load">
            <RefreshCwIcon aria-hidden="true" />
            {{ t("panel.common.retry") }}
          </Button>
        </div>

        <p
          v-else-if="!items.length"
          class="px-4 py-8 text-center text-[13.5px] text-muted-foreground"
        >
          {{ t("panel.notifications.empty") }}
        </p>

        <template v-else>
          <ul class="divide-y">
            <li v-for="item in items" :key="item.id">
              <NotificationRow
                :item="item"
                :now="now.getTime()"
                @open="onOpenItem(item.id)"
              />
            </li>
          </ul>
        </template>
      </div>

      <!-- Подпись видна и без прокрутки до последней строки. -->
      <p
        v-if="!loading && state === 'ready' && items.length && hasMore"
        class="border-t px-4 py-2 text-center text-[12px] text-muted-foreground"
      >
        {{ t("panel.notifications.latest", { n: BELL_SIZE }) }}
      </p>

      <footer class="grid grid-cols-2 gap-1 border-t px-2 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          class="justify-center text-[12.5px]"
          as-child
          @click="open = false"
        >
          <NuxtLink to="/notifications">
            {{ t("panel.notifications.viewAll") }}
          </NuxtLink>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="justify-center text-[12.5px]"
          as-child
          @click="open = false"
        >
          <NuxtLink to="/settings/notifications">
            {{ t("panel.notifications.settingsShort") }}
          </NuxtLink>
        </Button>
      </footer>
    </PopoverContent>
  </Popover>
</template>
