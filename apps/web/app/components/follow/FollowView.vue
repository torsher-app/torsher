<script setup lang="ts">
import type { FollowSummary } from '@torsher/api-client'
import {
  CircleAlertIcon,
  EyeIcon,
  HistoryIcon,
  RefreshCwIcon,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import ListGroup from '~/components/ListGroup.vue'
import PageBar from '~/components/shell/PageBar.vue'
import DeleteFollowDialog from './DeleteFollowDialog.vue'
import FollowFilters from './FollowFilters.vue'
import FollowRow from './FollowRow.vue'
import FollowSheet from './FollowSheet.vue'

const { t, locale } = useI18n()
const { follows, state, load, refresh } = useFollows()
const { filter, search, groups, resetFilters } = useFollowsList()
const actions = useFollowActions()

const loading = useHeldLoading(
  () => state.value === 'loading' || state.value === 'idle',
)

const selectedId = ref<string | null>(null)
const deleteTarget = ref<FollowSummary | null>(null)

const selected = computed(
  () => follows.value.find(item => item.id === selectedId.value) ?? null,
)
const isDeleteOpen = computed({
  get: () => !!deleteTarget.value,
  set: (isOpen) => {
    if (!isOpen)
      deleteTarget.value = null
  },
})

// Удалённое слежение закрывает свою карточку
watch(selected, (follow) => {
  if (!follow)
    selectedId.value = null
})

// Названия и сезоны — из TMDB на языке панели: сменили язык — перечитываем тихо
watch(locale, () => {
  void refresh()
})

onMounted(load)
</script>

<template>
  <PageBar :title="t('panel.follow.title')" :parent="t('panel.nav.server')">
    <template #actions>
      <Button
        as-child
        variant="ghost"
        size="sm"
        :aria-label="t('panel.follow.activity.title')"
      >
        <NuxtLink to="/follow/activity">
          <HistoryIcon aria-hidden="true" />
          <span class="hidden md:inline">{{
            t("panel.follow.activity.title")
          }}</span>
        </NuxtLink>
      </Button>
    </template>
  </PageBar>

  <!-- Скелетон повторяет строку фильтров, заголовок группы и строки той же высоты -->
  <div v-if="loading" aria-busy="true">
    <div class="flex min-h-11 items-center gap-2 border-b pr-2.5 pl-3">
      <Skeleton v-for="chip in 3" :key="chip" class="h-7 w-24 rounded-md" />
    </div>
    <div class="flex min-h-9 items-center gap-3 border-b bg-muted px-4">
      <Skeleton class="h-3 w-24" />
    </div>
    <div
      v-for="row in 4"
      :key="row"
      class="grid grid-cols-[28px_minmax(0,1fr)_28px] items-center gap-x-3 gap-y-1.5 border-b py-2.5 pr-2.5 pl-4 md:h-14 md:grid-cols-[28px_minmax(0,1.3fr)_minmax(0,1fr)_88px_36px] md:py-0"
    >
      <Skeleton class="row-span-2 h-10 w-7 rounded md:row-span-1" />
      <div class="grid gap-1.5">
        <Skeleton class="h-3.5 w-3/5" />
        <Skeleton class="h-3 w-4/5" />
      </div>
      <Skeleton class="hidden h-3 w-32 md:block" />
      <Skeleton class="hidden h-5 w-12 md:block" />
      <Skeleton class="size-7 justify-self-end" />
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
        {{ t("panel.follow.loadError") }}
      </h2>
      <p class="text-muted-foreground">
        {{ t("panel.follow.loadErrorText") }}
      </p>
      <Button variant="outline" class="mt-1" @click="load">
        <RefreshCwIcon aria-hidden="true" />
        {{ t("panel.common.retry") }}
      </Button>
    </section>
  </div>

  <section
    v-else-if="follows.length === 0"
    class="mx-auto grid max-w-140 justify-items-center gap-3.5 px-4 pt-[12vh] pb-8 text-center"
  >
    <div
      class="grid size-11 place-items-center rounded-xl border bg-muted"
      aria-hidden="true"
    >
      <EyeIcon class="size-5" />
    </div>
    <h2 class="text-base font-semibold">
      {{ t("panel.follow.empty.title") }}
    </h2>
    <p class="max-w-[52ch] text-pretty text-muted-foreground">
      {{ t("panel.follow.empty.text") }}
    </p>
    <p class="mt-1.5 max-w-[56ch] text-[12.5px] text-muted-foreground">
      {{ t("panel.follow.empty.foot") }}
    </p>
  </section>

  <template v-else>
    <FollowFilters />

    <div class="min-h-0 flex-1 overflow-y-auto" data-follow-list>
      <section
        v-for="group in groups"
        :key="group.key"
        :aria-label="t(`panel.follow.groups.${group.key}`)"
      >
        <ListGroup :title="t(`panel.follow.groups.${group.key}`)">
          <template #meta>
            <span class="tabular-nums">{{ group.items.length }}</span>
          </template>
        </ListGroup>
        <ul>
          <FollowRow
            v-for="follow in group.items"
            :key="follow.id"
            :follow="follow"
            :selected="follow.id === selectedId"
            :busy="actions.isBusy(follow.id)"
            @open="selectedId = follow.id"
            @search="actions.searchNow(follow)"
            @toggle-pause="actions.togglePause(follow)"
            @delete="deleteTarget = follow"
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
              ? t("panel.follow.filters.nothing", { query: search })
              : t(`panel.follow.filters.nothing_${filter}`)
          }}
        </p>
        <Button variant="outline" size="sm" @click="resetFilters">
          {{ t("panel.follow.filters.reset") }}
        </Button>
      </div>
    </div>
  </template>

  <FollowSheet
    :follow="selected"
    @close="selectedId = null"
    @delete="deleteTarget = selected"
  />
  <DeleteFollowDialog v-model:open="isDeleteOpen" :follow="deleteTarget" />
</template>
