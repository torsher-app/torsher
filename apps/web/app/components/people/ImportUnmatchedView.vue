<script setup lang="ts">
import type { UnmatchedImportRow } from '@torsher/api-client'
import {
  CheckCheckIcon,
  CircleAlertIcon,
  FilmIcon,
  RefreshCwIcon,
  XIcon,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import ListGroup from '~/components/ListGroup.vue'
import LoadingButton from '~/components/LoadingButton.vue'
import PageBar from '~/components/shell/PageBar.vue'
import { useImportUnmatched } from '~/composables/useImportUnmatched'
import MatchImportRowDialog from './MatchImportRowDialog.vue'
import ProfileAvatar from './ProfileAvatar.vue'

const PAGE_SIZE = 50

const { t } = useI18n()
const route = useRoute()
const profilesStore = useProfiles()

const profileId = computed(() => String(route.params.id))

const {
  items,
  total,
  state,
  loadingMore,
  hasMore,
  load,
  more,
  match,
  dismiss,
} = useImportUnmatched(profileId, { limit: PAGE_SIZE })

const profile = computed(
  () =>
    profilesStore.profiles.value.find(item => item.id === profileId.value)
    ?? null,
)

const busyRow = ref<string | null>(null)
const searching = ref<UnmatchedImportRow | null>(null)
const searchOpen = ref(false)

onMounted(() => {
  if (profilesStore.state.value === 'idle')
    void profilesStore.load()
})

function meta(row: UnmatchedImportRow) {
  const what
    = row.list === 'rating'
      ? t('panel.imports.unmatched.rating', { n: row.rating })
      : t('panel.imports.unmatched.watchlist')
  const status = row.suggestion
    ? t('panel.imports.unmatched.suggestion', {
        title: [row.suggestion.title, row.suggestion.year]
          .filter(Boolean)
          .join(', '),
      })
    : t('panel.imports.unmatched.notFound')

  return `${what} · ${status}`
}

async function confirm(row: UnmatchedImportRow) {
  if (!row.suggestion)
    return

  busyRow.value = row.id

  try {
    await match(row.id, row.suggestion.id)
    toast.success(
      t('panel.imports.unmatched.matched', { title: row.suggestion.title }),
    )
  }
  catch {
    toast.error(t('panel.imports.unmatched.saveFailed'))
  }
  finally {
    busyRow.value = null
  }
}

async function hide(row: UnmatchedImportRow) {
  busyRow.value = row.id

  try {
    await dismiss(row.id)
  }
  catch {
    toast.error(t('panel.imports.unmatched.saveFailed'))
  }
  finally {
    busyRow.value = null
  }
}

function find(row: UnmatchedImportRow) {
  searching.value = row
  searchOpen.value = true
}

async function saveFound(titleId: string) {
  const row = searching.value

  if (!row)
    return

  await match(row.id, titleId)
  toast.success(t('panel.imports.unmatched.matchedShort'))
}
</script>

<template>
  <PageBar
    :title="
      profile
        ? t('panel.imports.unmatched.title', { name: profile.name })
        : t('panel.imports.unmatched.titleShort')
    "
    :parent="t('panel.people.title')"
    parent-to="/people"
  />

  <div v-if="state === 'loading' && items.length === 0" aria-busy="true">
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
        <Skeleton class="h-3 w-36 max-w-1/2" />
      </div>
      <Skeleton class="h-6 w-20" />
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
        {{ t("panel.imports.unmatched.loadError") }}
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
        <CheckCheckIcon class="size-5" />
      </div>
      <h2 class="text-base font-semibold">
        {{ t("panel.imports.unmatched.emptyTitle") }}
      </h2>
      <p class="text-muted-foreground">
        {{ t("panel.imports.unmatched.emptyText") }}
      </p>
      <Button variant="outline" class="mt-1" as-child>
        <NuxtLink to="/people">
          {{ t("panel.imports.unmatched.back") }}
        </NuxtLink>
      </Button>
    </section>
  </div>

  <div v-else class="flex min-h-0 flex-1 flex-col">
    <div class="min-h-0 flex-1 overflow-y-auto">
      <ListGroup :title="t('panel.imports.unmatched.group', { n: total })">
        <template #meta>
          <span v-if="profile" class="inline-flex items-center gap-1.5">
            <ProfileAvatar :name="profile.name" :color="profile.color" />
            {{ profile.name }}
          </span>
        </template>
      </ListGroup>
      <ul>
        <li
          v-for="row in items"
          :key="row.id"
          class="flex h-14 items-center gap-3 border-b pr-2 pl-4 text-[13.5px]"
        >
          <span
            class="grid h-10 w-7 shrink-0 place-items-center overflow-hidden rounded-sm bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            <img
              v-if="row.suggestion?.poster"
              :src="row.suggestion.poster"
              alt=""
              class="size-full object-cover"
              loading="lazy"
              decoding="async"
            >
            <FilmIcon v-else class="size-3.5" />
          </span>
          <span class="grid min-w-0 flex-1">
            <span class="truncate font-medium">
              {{ [row.title, row.year].filter(Boolean).join(" · ") }}
            </span>
            <span class="truncate text-[12.5px] text-muted-foreground">
              {{ meta(row) }}
            </span>
          </span>
          <span class="flex shrink-0 items-center gap-1">
            <LoadingButton
              v-if="row.suggestion"
              variant="outline"
              size="xs"
              :loading="busyRow === row.id"
              :disabled="!!busyRow"
              @click="confirm(row)"
            >
              {{ t("panel.imports.unmatched.confirm") }}
            </LoadingButton>
            <Button
              variant="ghost"
              size="xs"
              :disabled="!!busyRow"
              @click="find(row)"
            >
              {{ t("panel.imports.unmatched.find") }}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              :disabled="!!busyRow"
              :aria-label="
                t('panel.imports.unmatched.hide', { title: row.title })
              "
              :title="t('panel.imports.unmatched.hide', { title: row.title })"
              @click="hide(row)"
            >
              <XIcon />
            </Button>
          </span>
        </li>
      </ul>
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

  <MatchImportRowDialog
    v-model:open="searchOpen"
    :row="searching"
    :save="saveFound"
  />
</template>
