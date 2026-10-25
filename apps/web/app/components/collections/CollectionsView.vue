<script setup lang="ts">
import type { Collection } from '@torsher/api-client'
import {
  BookmarkIcon,
  CircleAlertIcon,
  PlusIcon,
  RefreshCwIcon,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import ListGroup from '~/components/ListGroup.vue'
import PageBar from '~/components/shell/PageBar.vue'
import CollectionDialog from './CollectionDialog.vue'
import CollectionRow from './CollectionRow.vue'
import CollectionSheet from './CollectionSheet.vue'
import DeleteCollectionDialog from './DeleteCollectionDialog.vue'

const { t } = useI18n()
const { collections, state, load } = useCollections()
const loading = useHeldLoading(
  () => state.value === 'loading' || state.value === 'idle',
)
const profilesStore = useProfiles()

const isCreateOpen = ref(false)
const selectedId = ref<string | null>(null)
const editTarget = ref<Collection | null>(null)
const deleteTarget = ref<Collection | null>(null)

const selected = computed(
  () => collections.value.find(item => item.id === selectedId.value) ?? null,
)

const profileNames = computed(
  () =>
    new Map(profilesStore.profiles.value.map(item => [item.id, item.name])),
)

function hiddenNames(collection: Collection) {
  return collection.hiddenFrom.flatMap(
    id => profileNames.value.get(id) ?? [],
  )
}

/** Флаг диалога из цели: закрытие диалога сбрасывает цель */
function dialogOf<T>(target: Ref<T | null>) {
  return computed({
    get: () => !!target.value,
    set: (isOpen: boolean) => {
      if (!isOpen)
        target.value = null
    },
  })
}

const isEditOpen = dialogOf(editTarget)
const isDeleteOpen = dialogOf(deleteTarget)

// Удалённая подборка закрывает свою карточку
watch(selected, (collection) => {
  if (!collection)
    selectedId.value = null
})

onMounted(() => {
  void load()

  if (profilesStore.state.value === 'idle')
    void profilesStore.load()
})
</script>

<template>
  <PageBar
    :title="t('panel.collections.title')"
    :parent="t('panel.nav.server')"
  >
    <template
      v-if="!loading && state === 'ready' && collections.length > 0"
      #actions
    >
      <Button size="sm" @click="isCreateOpen = true">
        <PlusIcon aria-hidden="true" />
        {{ t("panel.collections.add") }}
      </Button>
    </template>
  </PageBar>

  <div v-if="loading" aria-busy="true">
    <div class="flex min-h-9 items-center border-b bg-muted px-4">
      <Skeleton class="h-3 w-24" />
    </div>
    <div
      v-for="row in 3"
      :key="row"
      class="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b py-2.5 pr-2.5 pl-4 sm:h-11 sm:grid-cols-[20px_minmax(0,240px)_minmax(0,1fr)_116px] sm:py-0"
    >
      <Skeleton class="row-span-2 size-4 rounded-sm sm:row-span-1" />
      <Skeleton class="h-3.5 w-32" />
      <Skeleton class="col-start-3 h-3 w-14 justify-self-end sm:col-start-4" />
      <Skeleton
        class="col-span-2 col-start-2 row-start-2 h-3 w-2/5 sm:col-span-1 sm:col-start-3 sm:row-start-1"
      />
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
        {{ t("panel.collections.loadError") }}
      </h2>
      <p class="text-muted-foreground">
        {{ t("panel.collections.loadErrorText") }}
      </p>
      <Button variant="outline" class="mt-1" @click="load">
        <RefreshCwIcon aria-hidden="true" />
        {{ t("panel.common.retry") }}
      </Button>
    </section>
  </div>

  <div
    v-else-if="collections.length === 0"
    class="min-h-0 flex-1 overflow-y-auto"
  >
    <section
      class="mx-auto grid max-w-130 justify-items-center gap-3.5 px-4 pt-[12vh] pb-8 text-center"
    >
      <div
        class="grid size-11 place-items-center rounded-xl border bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <BookmarkIcon class="size-5" />
      </div>
      <h2 class="text-base font-semibold">
        {{ t("panel.collections.emptyTitle") }}
      </h2>
      <p class="text-muted-foreground">
        {{ t("panel.collections.emptyText") }}
      </p>
      <Button class="mt-1" @click="isCreateOpen = true">
        <PlusIcon aria-hidden="true" />
        {{ t("panel.collections.add") }}
      </Button>
    </section>
  </div>

  <div v-else class="min-h-0 flex-1 overflow-y-auto" data-collections-list>
    <section :aria-label="t('panel.collections.title')">
      <ListGroup :title="t('panel.collections.title')">
        <template #meta>
          <span class="tabular-nums">{{ collections.length }}</span>
        </template>
      </ListGroup>
      <ul>
        <CollectionRow
          v-for="collection in collections"
          :key="collection.id"
          :collection="collection"
          :selected="collection.id === selectedId"
          :hidden-names="hiddenNames(collection)"
          @open="selectedId = collection.id"
          @edit="editTarget = collection"
          @delete="deleteTarget = collection"
        />
      </ul>
    </section>
  </div>

  <CollectionSheet
    :collection="selected"
    @close="selectedId = null"
    @edit="editTarget = selected"
    @delete="deleteTarget = selected"
  />
  <CollectionDialog v-model:open="isCreateOpen" />
  <CollectionDialog v-model:open="isEditOpen" :collection="editTarget" />
  <DeleteCollectionDialog
    v-model:open="isDeleteOpen"
    :collection="deleteTarget"
  />
</template>
