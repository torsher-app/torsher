<script setup lang="ts">
import type { NotificationChannel } from '@torsher/api-client'
import {
  BellIcon,
  CircleAlertIcon,
  PlusIcon,
  RefreshCwIcon,
} from '@lucide/vue'
import { useNow } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import ChannelDialog from '~/components/notifications/ChannelDialog.vue'
import ChannelRow from '~/components/notifications/ChannelRow.vue'
import DeleteChannelDialog from '~/components/notifications/DeleteChannelDialog.vue'

definePageMeta({
  middleware: 'required-auth',
})

const { t } = useI18n()
const { channels, state, load, setEnabled, test } = useNotificationChannels()
const loading = useHeldLoading(
  () => state.value === 'loading' || state.value === 'idle',
)
const now = useNow({ interval: 60_000 })

const dialogOpen = ref(false)
const editing = ref<NotificationChannel>()
const deleteOpen = ref(false)
const deleting = ref<NotificationChannel | null>(null)
const toggling = ref<string | null>(null)

onMounted(load)

function onAdd() {
  editing.value = undefined
  dialogOpen.value = true
}

function onEdit(channel: NotificationChannel) {
  editing.value = channel
  dialogOpen.value = true
}

function onRemove(channel: NotificationChannel) {
  deleting.value = channel
  deleteOpen.value = true
}

async function onToggle(channel: NotificationChannel, enabled: boolean) {
  toggling.value = channel.id

  try {
    await setEnabled(channel.id, enabled)
  }
  catch {
    // Ошибку запроса уже показал тостом клиент API
  }
  finally {
    toggling.value = null
  }
}

async function onTest(channel: NotificationChannel) {
  try {
    const result = await test(channel.id)

    if (result.ok) {
      toast.success(t('panel.notifications.test.sent', { name: channel.name }))
    }
    else {
      toast.error(
        t(`panel.notifications.test.errors.${result.kind ?? 'unavailable'}`),
      )
    }
  }
  catch {
    // Ошибку запроса уже показал тостом клиент API
  }
}
</script>

<template>
  <div class="grid gap-5">
    <header>
      <h1 class="text-[22px] font-semibold tracking-tight">
        {{ t("panel.settings.nav.notifications") }}
      </h1>
      <p class="mt-1 text-muted-foreground">
        {{ t("panel.notifications.description") }}
      </p>
    </header>

    <section class="grid gap-2.5" aria-labelledby="notification-channels">
      <div class="flex min-h-8 items-center justify-between gap-3">
        <h2
          id="notification-channels"
          class="text-[15px] font-semibold tracking-tight"
        >
          {{ t("panel.notifications.channels") }}
        </h2>
        <Button
          v-if="!loading && state === 'ready' && channels.length"
          size="sm"
          @click="onAdd"
        >
          <PlusIcon aria-hidden="true" />
          {{ t("panel.notifications.add") }}
        </Button>
      </div>

      <!-- Скелетон строк той же высоты, что строки каналов -->
      <div v-if="loading" class="divide-y rounded-xl border" aria-busy="true">
        <div
          v-for="index in 2"
          :key="index"
          class="grid grid-cols-[20px_minmax(0,1fr)_auto] gap-x-3 px-4 py-3"
        >
          <Skeleton class="mt-0.5 size-4 rounded" />
          <span class="grid gap-1.5">
            <Skeleton class="h-4 w-32" />
            <Skeleton class="h-3.5 w-48" />
            <Skeleton class="h-3.5 w-28" />
          </span>
          <Skeleton class="h-5 w-9 rounded-full" />
        </div>
      </div>

      <section
        v-else-if="state === 'error'"
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
          {{ t("panel.notifications.loadChannelsError") }}
        </h2>
        <Button variant="outline" @click="load">
          <RefreshCwIcon aria-hidden="true" />
          {{ t("panel.common.retry") }}
        </Button>
      </section>

      <section
        v-else-if="!channels.length"
        class="grid justify-items-center gap-3.5 rounded-xl border px-4 py-10 text-center"
      >
        <div
          class="grid size-11 place-items-center rounded-xl border bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          <BellIcon class="size-5" />
        </div>
        <h3 class="text-base font-semibold">
          {{ t("panel.notifications.emptyTitle") }}
        </h3>
        <p class="max-w-[46ch] text-muted-foreground">
          {{ t("panel.notifications.emptyText") }}
        </p>
        <Button @click="onAdd">
          <PlusIcon aria-hidden="true" />
          {{ t("panel.notifications.add") }}
        </Button>
      </section>

      <ul v-else class="divide-y rounded-xl border">
        <ChannelRow
          v-for="channel in channels"
          :key="channel.id"
          :channel="channel"
          :now="now.getTime()"
          :toggling="toggling === channel.id"
          @edit="onEdit(channel)"
          @test="onTest(channel)"
          @remove="onRemove(channel)"
          @toggle="(enabled) => onToggle(channel, enabled)"
        />
      </ul>
      <p class="text-[12.5px] text-muted-foreground">
        {{ t("panel.notifications.centerHint") }}
      </p>
    </section>

    <ChannelDialog v-model:open="dialogOpen" :channel="editing" />
    <DeleteChannelDialog v-model:open="deleteOpen" :channel="deleting" />
  </div>
</template>
