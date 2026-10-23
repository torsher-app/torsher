<script setup lang="ts">
import { isSingleVideo, videoIndexes } from '~/lib/torrents'
import type { Torrent } from '@torsher/api-client'
import {
  CircleAlertIcon,
  MagnetIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCwIcon,
} from '@lucide/vue'
import { useNow } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import ListGroup from '~/components/ListGroup.vue'
import PageBar from '~/components/shell/PageBar.vue'
import AddTorrentDialog from './AddTorrentDialog.vue'
import DeleteDownloadDialog from './DeleteDownloadDialog.vue'
import DownloadCard from './DownloadCard.vue'
import DownloadRow from './DownloadRow.vue'
import DownloadsFilters from './DownloadsFilters.vue'
import RestartEngineDialog from './RestartEngineDialog.vue'

const { t } = useI18n()
const { torrents, engine, state, isEmpty, load, stopPolling } = useTorrents()
const { filter, search, groups, resetFilters } = useDownloadsList()
const actions = useDownloadActions()

// Относительное время в карточке обновляется само, без перечитывания списка
const now = useNow({ interval: 30_000 })

const isAddOpen = ref(false)
const isRestartOpen = ref(false)
const selectedId = ref<string | null>(null)
// Карточка, открытая после добавления: видео в ней отмечены заранее
const preselectId = ref<string | null>(null)

// Фильм качается сразу; сериал и magnet без списка файлов — карточка с выбором
function onAdded(torrent: Torrent, existed: boolean) {
  if (!existed && isSingleVideo(torrent)) {
    void actions.download(torrent, videoIndexes(torrent))
    return
  }

  preselectId.value = existed ? null : torrent.id
  selectedId.value = torrent.id
}

const deleteTarget = ref<Torrent | null>(null)

const selected = computed(
  () => torrents.value.find(item => item.id === selectedId.value) ?? null,
)
const isDeleteOpen = computed({
  get: () => !!deleteTarget.value,
  set: (isOpen) => {
    if (!isOpen)
      deleteTarget.value = null
  },
})

// Удалённая раздача закрывает свою карточку
watch(selected, (torrent) => {
  if (!torrent)
    selectedId.value = null
})

onMounted(load)
onBeforeUnmount(stopPolling)
</script>

<template>
  <PageBar :title="t('panel.torrents.title')" :parent="t('panel.nav.server')">
    <template v-if="state === 'ready'" #actions>
      <!-- Запасной путь, если движок завис, а сам сервер этого не распознал.
           Пока движок запускается, перезапуск ничего не даст -->
      <Button
        variant="ghost"
        size="sm"
        :disabled="engine !== 'ready'"
        :aria-label="t('panel.torrents.restartEngine')"
        @click="isRestartOpen = true"
      >
        <RotateCwIcon aria-hidden="true" />
        <span class="hidden md:inline">{{
          t("panel.torrents.restartEngine")
        }}</span>
      </Button>
      <Button v-if="!isEmpty" size="sm" @click="isAddOpen = true">
        <PlusIcon aria-hidden="true" />
        {{ t("panel.torrents.add") }}
      </Button>
    </template>
  </PageBar>

  <!-- Скелетон повторяет строку фильтров, заголовок группы и строки той же высоты -->
  <div v-if="state === 'loading' || state === 'idle'" aria-busy="true">
    <div class="flex min-h-11 items-center gap-2 border-b pr-2.5 pl-3">
      <Skeleton v-for="chip in 4" :key="chip" class="h-7 w-20 rounded-md" />
    </div>
    <div class="flex min-h-9 items-center gap-3 border-b bg-muted px-4">
      <Skeleton class="h-3 w-24" />
    </div>
    <div
      v-for="row in 4"
      :key="row"
      class="grid grid-cols-[28px_minmax(0,1fr)_72px] items-center gap-x-3 border-b py-2.5 pr-2.5 pl-4 md:h-14 md:grid-cols-[28px_minmax(0,1.3fr)_150px_minmax(0,1fr)_72px] md:py-0"
    >
      <Skeleton class="h-10 w-7 rounded" />
      <div class="grid gap-1.5">
        <Skeleton class="h-3.5 w-3/5" />
        <Skeleton class="h-3 w-2/5" />
      </div>
      <Skeleton class="hidden h-3 w-24 md:block" />
      <Skeleton class="hidden h-1 w-full md:block" />
      <Skeleton class="h-6 w-14 justify-self-end" />
    </div>
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

  <template v-else>
    <Alert
      v-if="engine !== 'ready'"
      variant="warning"
      class="rounded-none border-b"
    >
      <CircleAlertIcon />
      <AlertTitle>{{ t(`panel.torrents.engine.titles.${engine}`) }}</AlertTitle>
      <AlertDescription>
        {{ t(`panel.torrents.engine.texts.${engine}`) }}
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

    <template v-else>
      <DownloadsFilters />

      <div class="min-h-0 flex-1 overflow-y-auto" data-downloads-list>
        <section
          v-for="group in groups"
          :key="group.key"
          :aria-label="t(`panel.torrents.groups.${group.key}`)"
        >
          <ListGroup :title="t(`panel.torrents.groups.${group.key}`)">
            <template #meta>
              <span class="tabular-nums">{{ group.items.length }}</span>
            </template>
          </ListGroup>
          <ul>
            <DownloadRow
              v-for="torrent in group.items"
              :key="torrent.id"
              :torrent="torrent"
              :selected="torrent.id === selectedId"
              :busy="actions.isBusy(torrent.id)"
              @open="selectedId = torrent.id"
              @toggle-pause="actions.togglePause(torrent)"
              @toggle-keep="actions.toggleKeep(torrent)"
              @retry="actions.retry(torrent)"
              @delete="deleteTarget = torrent"
            />
          </ul>
        </section>

        <!-- Пустой результат фильтра говорит, что именно пусто -->
        <div
          v-if="groups.length === 0"
          class="grid justify-items-center gap-3 px-4 pt-[8vh] pb-8 text-center text-muted-foreground"
        >
          <p>
            {{
              search
                ? t("panel.torrents.filters.nothing", { query: search })
                : t("panel.torrents.filters.nothingFilter")
            }}
          </p>
          <Button
            v-if="search || filter !== 'all'"
            variant="outline"
            size="sm"
            @click="resetFilters"
          >
            {{ t("panel.torrents.filters.reset") }}
          </Button>
        </div>
      </div>
    </template>
  </template>

  <DownloadCard
    :torrent="selected"
    :now="now.getTime()"
    :preselect="!!selected && selected.id === preselectId"
    @close="selectedId = null"
    @delete="deleteTarget = selected"
  />
  <AddTorrentDialog v-model:open="isAddOpen" @added="onAdded" />
  <RestartEngineDialog v-model:open="isRestartOpen" />
  <DeleteDownloadDialog v-model:open="isDeleteOpen" :torrent="deleteTarget" />
</template>
