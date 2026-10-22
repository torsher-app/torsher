<script setup lang="ts">
import {
  ArrowUpIcon,
  CircleAlertIcon,
  DownloadIcon,
  EllipsisIcon,
  RefreshCwIcon,
  ScrollTextIcon,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import ListGroup from '~/components/ListGroup.vue'
import LoadingButton from '~/components/LoadingButton.vue'
import PageBar from '~/components/shell/PageBar.vue'
import { logSourceLabels } from '~/lib/logs'
import LogEntrySheet from './LogEntrySheet.vue'
import LogRow from './LogRow.vue'
import LogsFilters from './LogsFilters.vue'
import LogsSkeleton from './LogsSkeleton.vue'

const { t } = useI18n()
const logs = useLogs()
const { reload } = useLogsFeed(logs)
const {
  entries,
  groups,
  pendingCount,
  state,
  isReloading,
  hasMore,
  isLoadingMore,
  journalLevel,
  levelLocked,
  isLevelBusy,
  isDownloading,
  levelFilter,
  source,
  search,
  isFiltered,
} = logs

const list = ref<HTMLElement | null>(null)
const selectedId = ref<number | null>(null)

const selected = computed(
  () => entries.value.find(entry => entry.id === selectedId.value) ?? null,
)
const isEmpty = computed(
  () => entries.value.length === 0 && !isFiltered.value && !isReloading.value,
)

// Пустой фильтр говорит, что именно пусто
const nothingText = computed(() => {
  if (search.value)
    return t('panel.logs.nothing.query', { query: search.value })

  if (source.value && levelFilter.value === 'all') {
    return t('panel.logs.nothing.source', {
      source: t(logSourceLabels[source.value]),
    })
  }

  return t(`panel.logs.nothing.${levelFilter.value}`)
})

// Запись, ушедшая из буфера или из фильтра, закрывает свою карточку
watch(selected, (entry) => {
  if (!entry)
    selectedId.value = null
})

function onScroll() {
  logs.setAtTop((list.value?.scrollTop ?? 0) < 4)
}

function onShowPending() {
  logs.showPending()
  list.value?.scrollTo({ top: 0 })
}

function onVerbose(value: boolean | 'indeterminate') {
  void logs.setLevel(value === true ? 'debug' : 'info')
}
</script>

<template>
  <PageBar :title="t('panel.logs.title')" :parent="t('panel.nav.server')">
    <template v-if="state === 'ready'" #actions>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="t('panel.logs.more')"
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-72">
          <DropdownMenuCheckboxItem
            :model-value="journalLevel === 'debug'"
            :disabled="levelLocked || isLevelBusy"
            class="items-start"
            @update:model-value="onVerbose"
          >
            <span class="grid gap-0.5">
              <span>{{ t("panel.logs.verbose.label") }}</span>
              <span class="text-xs text-muted-foreground">{{
                t(
                  levelLocked
                    ? "panel.logs.verbose.locked"
                    : "panel.logs.verbose.hint",
                )
              }}</span>
            </span>
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <LoadingButton
        size="sm"
        :loading="isDownloading"
        :aria-label="t('panel.logs.download.action')"
        @click="logs.download"
      >
        <DownloadIcon aria-hidden="true" />
        <span class="hidden md:inline">{{
          t("panel.logs.download.action")
        }}</span>
      </LoadingButton>
    </template>
  </PageBar>

  <LogsSkeleton v-if="state === 'loading' || state === 'idle'" />

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
        {{ t("panel.logs.loadError") }}
      </h2>
      <p class="text-muted-foreground">
        {{ t("panel.logs.loadErrorText") }}
      </p>
      <Button variant="outline" class="mt-1" @click="reload">
        <RefreshCwIcon aria-hidden="true" />
        {{ t("panel.common.retry") }}
      </Button>
    </section>
  </div>

  <section
    v-else-if="isEmpty"
    class="mx-auto grid max-w-140 justify-items-center gap-3.5 px-4 pt-[12vh] pb-8 text-center"
  >
    <div
      class="grid size-11 place-items-center rounded-xl border bg-muted"
      aria-hidden="true"
    >
      <ScrollTextIcon class="size-5" />
    </div>
    <h2 class="text-base font-semibold">
      {{ t("panel.logs.empty.title") }}
    </h2>
    <p class="max-w-[52ch] text-pretty text-muted-foreground">
      {{ t("panel.logs.empty.text") }}
    </p>
  </section>

  <template v-else>
    <LogsFilters />

    <LogsSkeleton v-if="isReloading" :filters="false" />

    <div v-else class="relative flex min-h-0 flex-1 flex-col">
      <!-- Плашка поверх списка: появление новых записей ничего не сдвигает -->
      <div
        v-if="pendingCount > 0"
        class="pointer-events-none absolute inset-x-0 top-11 z-10 flex justify-center px-4"
      >
        <Button
          variant="outline"
          size="sm"
          class="pointer-events-auto rounded-full bg-background shadow-md"
          @click="onShowPending"
        >
          <ArrowUpIcon aria-hidden="true" />
          <span class="tabular-nums">{{
            t("panel.logs.newEntries", { n: pendingCount }, pendingCount)
          }}</span>
        </Button>
      </div>

      <div
        ref="list"
        class="min-h-0 flex-1 overflow-y-auto"
        data-logs-list
        @scroll.passive="onScroll"
      >
        <section
          v-for="group in groups"
          :key="group.key"
          :aria-label="group.title"
        >
          <ListGroup :title="group.title">
            <template #meta>
              <span class="tabular-nums">{{ group.items.length }}</span>
            </template>
          </ListGroup>
          <ul>
            <LogRow
              v-for="entry in group.items"
              :key="entry.id"
              :entry="entry"
              :selected="entry.id === selectedId"
              @open="selectedId = entry.id"
            />
          </ul>
        </section>

        <div
          v-if="groups.length === 0"
          class="grid justify-items-center gap-3 px-4 pt-[8vh] pb-8 text-center text-muted-foreground"
        >
          <p>{{ nothingText }}</p>
          <Button variant="outline" size="sm" @click="logs.resetFilters">
            {{ t("panel.logs.nothing.showAll") }}
          </Button>
        </div>

        <div
          v-else
          class="flex min-h-14 items-center justify-center px-4 py-3 text-[12.5px] text-muted-foreground"
        >
          <LoadingButton
            v-if="hasMore"
            variant="outline"
            size="sm"
            :loading="isLoadingMore"
            @click="logs.loadMore"
          >
            {{ t("panel.logs.showMore") }}
          </LoadingButton>
          <p v-else>
            {{ t("panel.logs.end") }}
          </p>
        </div>
      </div>
    </div>
  </template>

  <LogEntrySheet
    :entry="selected"
    @close="selectedId = null"
    @copy="logs.copyEntry"
  />
</template>
