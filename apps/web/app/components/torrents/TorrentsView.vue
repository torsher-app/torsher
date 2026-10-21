<script setup lang="ts">
import type { Torrent } from '@torsher/api-client'
import {
  CircleAlertIcon,
  MagnetIcon,
  PlusIcon,
  RefreshCwIcon,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import PageBar from '~/components/shell/PageBar.vue'
import { torrentErrorKind } from '~/composables/useTorrents'
import AddTorrentDialog from './AddTorrentDialog.vue'
import DeleteTorrentDialog from './DeleteTorrentDialog.vue'
import TorrentGroup from './TorrentGroup.vue'

const { t } = useI18n()
const { torrents, engine, state, isEmpty, load, retryTorrent, stopPolling }
  = useTorrents()

const isAddOpen = ref(false)
const deleteTarget = ref<Torrent | null>(null)
const retryingIds = ref(new Set<string>())

const isDeleteOpen = computed({
  get: () => !!deleteTarget.value,
  set: (isOpen) => {
    if (!isOpen)
      deleteTarget.value = null
  },
})

async function onRetry(torrent: Torrent) {
  retryingIds.value = new Set([...retryingIds.value, torrent.id])

  try {
    await retryTorrent(torrent.id)
  }
  catch (err) {
    const kind = await torrentErrorKind(err)

    toast.error(t(`panel.torrents.errorTitles.${kind}`), {
      description: t(`panel.torrents.errors.${kind}`),
    })
  }
  finally {
    const next = new Set(retryingIds.value)

    next.delete(torrent.id)
    retryingIds.value = next
  }
}

onMounted(load)
onBeforeUnmount(stopPolling)
</script>

<template>
  <PageBar :title="t('panel.torrents.title')" :parent="t('panel.nav.server')">
    <template v-if="state === 'ready' && !isEmpty" #actions>
      <Button size="sm" @click="isAddOpen = true">
        <PlusIcon aria-hidden="true" />
        {{ t("panel.torrents.add") }}
      </Button>
    </template>
  </PageBar>

  <!-- Скелетон повторяет заголовок раздачи и строки файлов -->
  <div v-if="state === 'loading' || state === 'idle'" aria-busy="true">
    <template v-for="group in 2" :key="group">
      <div class="flex min-h-9 items-center gap-3 border-b bg-muted px-4">
        <Skeleton class="h-3 w-48" />
        <Skeleton class="h-3 w-20" />
      </div>
      <div
        v-for="row in 3"
        :key="row"
        class="grid grid-cols-[16px_minmax(0,1fr)_88px] items-center gap-x-3 border-b py-2.5 pr-2.5 pl-4 sm:h-11 sm:py-0"
      >
        <Skeleton class="size-4 rounded" />
        <Skeleton class="h-3.5 w-3/5" />
        <Skeleton class="h-3 w-14 justify-self-end" />
      </div>
    </template>
  </div>

  <div v-else-if="state === 'error'" class="min-h-0 flex-1 overflow-y-auto">
    <section
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
        {{ t("panel.torrents.loadError") }}
      </h2>
      <p class="text-muted-foreground">
        {{ t("panel.torrents.loadErrorText") }}
      </p>
      <Button variant="outline" class="mt-1" @click="load">
        <RefreshCwIcon aria-hidden="true" />
        {{ t("panel.common.retry") }}
      </Button>
    </section>
  </div>

  <div v-else class="min-h-0 flex-1 overflow-y-auto">
    <Alert
      v-if="engine !== 'ready'"
      variant="warning"
      class="rounded-none border-b"
    >
      <CircleAlertIcon />
      <AlertTitle>{{ t(`panel.torrents.engine.titles.${engine}`) }}</AlertTitle>
      <AlertDescription>
        {{
          t(`panel.torrents.engine.texts.${engine}`)
        }}
      </AlertDescription>
    </Alert>

    <section
      v-if="isEmpty"
      class="mx-auto grid max-w-140 justify-items-center gap-3.5 px-4 pt-[12vh] pb-8 text-center"
    >
      <div
        class="grid size-11 place-items-center rounded-xl border bg-muted"
        aria-hidden="true"
      >
        <MagnetIcon class="size-5" />
      </div>
      <h2 class="text-base font-semibold">
        {{ t("panel.torrents.empty.title") }}
      </h2>
      <p class="max-w-[52ch] text-pretty text-muted-foreground">
        {{ t("panel.torrents.empty.text") }}
      </p>
      <Button class="mt-1" @click="isAddOpen = true">
        <PlusIcon aria-hidden="true" />
        {{ t("panel.torrents.add") }}
      </Button>
      <p class="mt-1.5 max-w-[56ch] text-[12.5px] text-muted-foreground">
        {{ t("panel.torrents.empty.foot") }}
      </p>
    </section>

    <TorrentGroup
      v-for="torrent in torrents"
      v-else
      :key="torrent.id"
      :torrent="torrent"
      :retrying="retryingIds.has(torrent.id)"
      @retry="onRetry(torrent)"
      @delete="deleteTarget = torrent"
    />
  </div>

  <AddTorrentDialog v-model:open="isAddOpen" />
  <DeleteTorrentDialog v-model:open="isDeleteOpen" :torrent="deleteTarget" />
</template>
