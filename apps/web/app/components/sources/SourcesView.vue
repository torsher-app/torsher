<script setup lang="ts">
import type { Indexer } from '@torsher/api-client'
import {
  ArrowDownToLineIcon,
  CircleAlertIcon,
  PlusIcon,
  RefreshCwIcon,
} from '@lucide/vue'
import { useNow } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import ListGroup from '~/components/ListGroup.vue'
import PageBar from '~/components/shell/PageBar.vue'
import { formatRelative, hostOf } from '~/lib/format'
import AddIndexerDialog from './AddIndexerDialog.vue'
import CheckProgress from './CheckProgress.vue'
import DeleteIndexerDialog from './DeleteIndexerDialog.vue'
import ImportManagerDialog from './ImportManagerDialog.vue'
import IndexerCard from './IndexerCard.vue'
import IndexerRow from './IndexerRow.vue'
import ManagerActions from './ManagerActions.vue'
import SourcesEmpty from './SourcesEmpty.vue'
import SourcesFilters from './SourcesFilters.vue'
import SourcesSkeleton from './SourcesSkeleton.vue'

const { t, locale } = useI18n()
const { indexers, managers, state, checkRun, isEmpty, load, stopPolling }
  = useSources()
const { filter, search, groups, resetFilters } = useSourcesList()

// Относительное время в строках обновляется само, без перечитывания списка
const now = useNow({ interval: 30_000 })

const isImportOpen = ref(false)
const isAddOpen = ref(false)
const selectedId = ref<string | null>(null)
const editTarget = ref<Indexer | null>(null)
const deleteTarget = ref<Indexer | null>(null)

const selected = computed(
  () => indexers.value.find(item => item.id === selectedId.value) ?? null,
)
const selectedManager = computed(() =>
  managers.value.find(item => item.id === selected.value?.managerId),
)
const isEditOpen = computed({
  get: () => !!editTarget.value,
  set: (isOpen) => {
    if (!isOpen)
      editTarget.value = null
  },
})
const isDeleteOpen = computed({
  get: () => !!deleteTarget.value,
  set: (isOpen) => {
    if (!isOpen)
      deleteTarget.value = null
  },
})
const isReady = computed(() => state.value === 'ready' && !isEmpty.value)

function groupTitle(
  kind: 'attention' | 'manager' | 'manual',
  managerKind?: string,
) {
  if (kind === 'manager')
    return t(`panel.kinds.${managerKind}`)

  return t(`panel.sources.groups.${kind}`)
}

// Удалённый индексатор закрывает свою карточку
watch(selected, (indexer) => {
  if (!indexer)
    selectedId.value = null
})

onMounted(load)
onBeforeUnmount(stopPolling)
</script>

<template>
  <PageBar :title="t('panel.sources.title')" :parent="t('panel.nav.server')">
    <template v-if="isReady" #actions>
      <Button
        variant="ghost"
        size="sm"
        :aria-label="t('panel.sources.add')"
        @click="isAddOpen = true"
      >
        <PlusIcon aria-hidden="true" />
        <span class="hidden md:inline">{{ t("panel.sources.add") }}</span>
      </Button>
      <Button size="sm" @click="isImportOpen = true">
        <ArrowDownToLineIcon aria-hidden="true" />
        {{ t("panel.sources.importShort") }}
      </Button>
    </template>
  </PageBar>

  <SourcesSkeleton v-if="state === 'loading' || state === 'idle'" />

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
        {{ t("panel.sources.loadError") }}
      </h2>
      <p class="text-muted-foreground">
        {{ t("panel.sources.loadErrorText") }}
      </p>
      <Button variant="outline" class="mt-1" @click="load">
        <RefreshCwIcon aria-hidden="true" />
        {{ t("panel.common.retry") }}
      </Button>
    </section>
  </div>

  <div v-else-if="isEmpty" class="min-h-0 flex-1 overflow-y-auto">
    <SourcesEmpty @import="isImportOpen = true" @add="isAddOpen = true" />
  </div>

  <template v-else>
    <SourcesFilters />
    <CheckProgress v-if="checkRun" :run="checkRun" />

    <div class="min-h-0 flex-1 overflow-y-auto" data-sources-list>
      <section
        v-for="group in groups"
        :key="group.key"
        :aria-label="groupTitle(group.kind, group.manager?.kind)"
      >
        <ListGroup :title="groupTitle(group.kind, group.manager?.kind)">
          <template #meta>
            <template v-if="group.manager">
              <span class="font-mono text-xs">{{
                hostOf(group.manager.url)
              }}</span>
              ·
              {{
                group.manager.syncedAt
                  ? t("panel.sources.managers.syncedAt", {
                    time: formatRelative(
                      group.manager.syncedAt,
                      locale,
                      now.getTime(),
                    ),
                  })
                  : t("panel.sources.managers.neverSynced")
              }}
            </template>
            <span v-else class="tabular-nums">{{ group.items.length }}</span>
          </template>
          <template v-if="group.manager" #actions>
            <ManagerActions :manager="group.manager" />
          </template>
        </ListGroup>
        <ul>
          <IndexerRow
            v-for="indexer in group.items"
            :key="indexer.id"
            :indexer="indexer"
            :selected="indexer.id === selectedId"
            :now="now.getTime()"
            @open="selectedId = indexer.id"
            @delete="deleteTarget = indexer"
          />
          <li
            v-if="group.manager && group.items.length === 0"
            class="border-b px-4 py-3 text-[13px] text-muted-foreground"
          >
            {{
              t("panel.sources.groups.emptyManager", {
                manager: t(`panel.kinds.${group.manager.kind}`),
              })
            }}
          </li>
        </ul>
      </section>

      <!-- Пустой результат фильтра говорит, что именно пусто -->
      <div
        v-if="groups.length === 0"
        class="grid justify-items-center gap-3 px-4 pt-[8vh] pb-8 text-center text-muted-foreground"
      >
        <p v-if="search">
          {{ t("panel.sources.filterEmpty.search", { q: search }) }}
        </p>
        <p v-else>
          {{ t(`panel.sources.filterEmpty.${filter}`) }}
        </p>
        <Button variant="outline" size="sm" @click="resetFilters">
          {{
            search
              ? t("panel.sources.filterEmpty.resetSearch")
              : t("panel.sources.filterEmpty.showAll")
          }}
        </Button>
      </div>
    </div>
  </template>

  <IndexerCard
    :indexer="selected"
    :manager="selectedManager"
    :now="now.getTime()"
    @close="selectedId = null"
    @edit="editTarget = selected"
    @delete="deleteTarget = selected"
  />
  <ImportManagerDialog v-model:open="isImportOpen" />
  <AddIndexerDialog v-model:open="isAddOpen" />
  <AddIndexerDialog v-model:open="isEditOpen" :indexer="editTarget" />
  <DeleteIndexerDialog v-model:open="isDeleteOpen" :indexer="deleteTarget" />
</template>
