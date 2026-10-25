<script setup lang="ts">
import { CircleAlertIcon, HistoryIcon, RefreshCwIcon } from '@lucide/vue'
import { useNow } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import ListGroup from '~/components/ListGroup.vue'
import LoadingButton from '~/components/LoadingButton.vue'
import ProfileAvatar from '~/components/people/ProfileAvatar.vue'
import PageBar from '~/components/shell/PageBar.vue'
import HistoryRow from './HistoryRow.vue'

// Порция истории: тайтлы приходят с деталями TMDB, всё разом — дорого
const PAGE_SIZE = 50

const { t } = useI18n()
const route = useRoute()
const profilesStore = useProfiles()
const now = useNow({ interval: 30_000 })

const profileId = computed(() => String(route.params.id))

const { items, total, state, loadingMore, hasMore, load, more }
  = useProfileHistory(profileId, {
    limit: PAGE_SIZE,
  })

const loading = useHeldLoading(() => state.value === 'loading')

const profile = computed(
  () =>
    profilesStore.profiles.value.find(item => item.id === profileId.value)
    ?? null,
)

onMounted(() => {
  if (profilesStore.state.value === 'idle')
    void profilesStore.load()
})
</script>

<template>
  <PageBar
    :title="
      profile
        ? t('panel.history.title', { name: profile.name })
        : t('panel.history.titleShort')
    "
    :parent="t('panel.people.title')"
    parent-to="/people"
  />

  <div v-if="loading" aria-busy="true">
    <div class="flex min-h-9 items-center border-b bg-muted px-4">
      <Skeleton class="h-3 w-24" />
    </div>
    <div
      v-for="row in 6"
      :key="row"
      class="flex h-14 items-center gap-3 border-b pr-3 pl-4"
    >
      <Skeleton class="h-10 w-7 rounded-sm" />
      <div class="grid flex-1 gap-1.5">
        <Skeleton class="h-3.5 w-48 max-w-2/3" />
        <Skeleton class="h-3 w-28" />
      </div>
      <Skeleton class="h-3 w-14" />
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
        {{ t("panel.history.loadError") }}
      </h2>
      <p class="text-muted-foreground">
        {{ t("panel.history.loadErrorText") }}
      </p>
      <Button variant="outline" class="mt-1" @click="load">
        <RefreshCwIcon aria-hidden="true" />
        {{ t("panel.common.retry") }}
      </Button>
    </section>
  </div>

  <div v-else-if="total === 0" class="min-h-0 flex-1 overflow-y-auto">
    <section
      class="mx-auto grid max-w-130 justify-items-center gap-3.5 px-4 pt-[12vh] pb-8 text-center"
    >
      <div
        class="grid size-11 place-items-center rounded-xl border bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <HistoryIcon class="size-5" />
      </div>
      <h2 class="text-base font-semibold">
        {{ t("panel.history.emptyTitle") }}
      </h2>
      <p class="text-muted-foreground">
        {{ t("panel.history.emptyText") }}
      </p>
    </section>
  </div>

  <div v-else class="flex min-h-0 flex-1 flex-col">
    <div class="min-h-0 flex-1 overflow-y-auto">
      <ListGroup :title="t('panel.history.group')">
        <template #meta>
          <span v-if="profile" class="inline-flex items-center gap-1.5">
            <ProfileAvatar :name="profile.name" :color="profile.color" />
            {{ profile.name }}
          </span>
        </template>
      </ListGroup>
      <ul>
        <HistoryRow
          v-for="entry in items"
          :key="entry.title.id"
          :entry="entry"
          :now="now.getTime()"
        />
      </ul>
      <!-- Следующая порция дописывается под показанным: список не прыгает -->
      <div v-if="hasMore" class="flex justify-center px-4 py-4">
        <LoadingButton
          variant="outline"
          size="sm"
          :loading="loadingMore"
          @click="more"
        >
          {{ t("panel.history.showMore") }}
        </LoadingButton>
      </div>
    </div>
  </div>
</template>
