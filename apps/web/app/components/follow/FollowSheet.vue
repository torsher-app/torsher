<script setup lang="ts">
import type { FollowSummary } from '@torsher/api-client'
import {
  CircleAlertIcon,
  CircleHelpIcon,
  CircleXIcon,
  HardDriveIcon,
  InfoIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from '@lucide/vue'
import { useNow } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import LoadingButton from '~/components/LoadingButton.vue'
import ProfileAvatar from '~/components/people/ProfileAvatar.vue'
import { followStatusOf, toneBadge } from '~/lib/follow'
import { formatDateTime, formatRelative } from '~/lib/format'
import { toneText } from '~/lib/indexerStatus'
import { keepOpenOnListClick } from '~/lib/sheet'
import FollowEpisodes from './FollowEpisodes.vue'
import FollowRulesForm from './FollowRulesForm.vue'

const props = defineProps<{
  follow: FollowSummary | null
}>()

const emit = defineEmits<{
  close: []
  delete: []
}>()

const { t, locale } = useI18n()
const store = useFollows()
const actions = useFollowActions()
const text = useFollowText()
const now = useNow({ interval: 30_000 })

// Пока лист уезжает, в нём остаётся последнее слежение, а не пустота
const shown = shallowRef<FollowSummary | null>(props.follow)
const detailsState = ref<'loading' | 'error' | 'ready'>('loading')
// Карточка живёт и закрытой: время скелетона идёт от выбора слежения
const detailsLoading = useHeldLoading(
  () => !!props.follow && detailsState.value === 'loading',
)

const details = computed(() =>
  store.details.value?.id === shown.value?.id ? store.details.value : null,
)

async function loadDetails() {
  const id = shown.value?.id

  if (!id)
    return

  detailsState.value = 'loading'

  try {
    await store.loadDetails(id)

    if (shown.value?.id === id)
      detailsState.value = 'ready'
  }
  catch {
    if (shown.value?.id === id)
      detailsState.value = 'error'
  }
}

watch(
  () => props.follow,
  (follow, previous) => {
    if (!follow)
      return

    shown.value = follow

    if (follow.id !== previous?.id)
      void loadDetails()
  },
  { immediate: true },
)

const view = computed(() => (shown.value ? followStatusOf(shown.value) : null))
const name = computed(() => shown.value?.title ?? shown.value?.titleId ?? '')
const isBusy = computed(() => !!shown.value && actions.isBusy(shown.value.id))
// Спиннер — только у «Искать сейчас»: «Не брать» и «Пауза» тоже занимают слежение
const isSearching = ref(false)

async function onSearch() {
  if (!shown.value)
    return

  isSearching.value = true

  try {
    await actions.searchNow(shown.value)
  }
  finally {
    isSearching.value = false
  }
}
const isPaused = computed(() => shown.value?.state === 'paused')

// Карточка — тоже на языке панели; показанное остаётся, пока идёт запрос
watch(locale, () => {
  if (shown.value)
    void store.loadDetails(shown.value.id).catch(() => {})
})

function relative(iso: string) {
  return formatRelative(iso, locale.value, now.value.getTime())
}

function onInteractOutside(event: Event) {
  keepOpenOnListClick(event, '[data-follow-list]')
}
</script>

<template>
  <Sheet
    :open="!!follow"
    :modal="false"
    @update:open="(isOpen) => !isOpen && emit('close')"
  >
    <SheetContent
      side="right"
      :show-close-button="false"
      class="gap-0 bg-background p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[440px] md:data-[side=right]:inset-y-2 md:data-[side=right]:right-2 md:data-[side=right]:h-auto md:rounded-r-xl md:border"
      @interact-outside="onInteractOutside"
    >
      <template v-if="shown && view">
        <header
          class="flex h-12 shrink-0 items-center gap-2 border-b pr-2 pl-4"
        >
          <component
            :is="view.icon"
            :class="cn('size-4 shrink-0 -translate-y-px', toneText[view.tone])"
            aria-hidden="true"
          />
          <SheetTitle class="min-w-0 flex-1 truncate text-[15px] font-semibold">
            {{ name }}
          </SheetTitle>
          <SheetDescription class="sr-only">
            {{ text.status(shown, view) }}
          </SheetDescription>
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="t('panel.common.close')"
            @click="emit('close')"
          >
            <XIcon />
          </Button>
        </header>

        <div
          class="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto p-4"
        >
          <Alert v-if="view.status === 'noSpace'" variant="destructive">
            <HardDriveIcon />
            <AlertTitle>{{ text.status(shown, view) }}</AlertTitle>
            <AlertDescription>
              {{ t("panel.follow.card.noSpace") }}
              <NuxtLink
                to="/settings/storage"
                class="mt-1 block font-medium text-foreground underline underline-offset-3"
              >
                {{ t("panel.follow.card.storageLink") }}
              </NuxtLink>
            </AlertDescription>
          </Alert>

          <Alert v-else-if="view.status === 'missing'" variant="warning">
            <CircleXIcon />
            <AlertTitle>{{ text.status(shown, view) }}</AlertTitle>
            <AlertDescription>
              {{ t("panel.follow.card.missing") }}
            </AlertDescription>
          </Alert>

          <Alert v-else-if="view.status === 'unsure'" variant="warning">
            <CircleHelpIcon />
            <AlertTitle>{{ text.status(shown, view) }}</AlertTitle>
            <AlertDescription>
              {{ t("panel.follow.card.unsure") }}
              <NuxtLink
                :to="{
                  path: '/follow/activity',
                  query: { tab: 'history', follow: shown.id, kind: 'unsure' },
                }"
                class="mt-1 block font-medium text-foreground underline underline-offset-3"
              >
                {{ t("panel.follow.card.unsureLink") }}
              </NuxtLink>
            </AlertDescription>
          </Alert>

          <Alert v-else-if="shown.state === 'stopped'" variant="info">
            <InfoIcon />
            <AlertTitle>{{ text.status(shown, view) }}</AlertTitle>
            <AlertDescription>
              {{ t("panel.follow.card.stopped") }}
            </AlertDescription>
          </Alert>

          <dl
            class="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-[13.5px]"
          >
            <dt class="text-muted-foreground">
              {{ t("panel.follow.card.status") }}
            </dt>
            <dd class="min-w-0">
              <Badge :variant="toneBadge[view.tone]" class="max-w-full">
                <span class="truncate">{{ text.status(shown, view) }}</span>
              </Badge>
            </dd>
            <dt class="self-start text-muted-foreground">
              {{ t("panel.follow.card.profiles") }}
            </dt>
            <dd class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span
                v-for="profile in shown.profiles"
                :key="profile.id"
                class="flex items-center gap-1.5"
              >
                <ProfileAvatar :name="profile.name" :color="profile.color" />
                {{ profile.name }}
              </span>
              <span
                v-if="shown.profiles.length === 0"
                class="text-muted-foreground"
              >{{ t("panel.follow.card.noProfiles") }}</span>
            </dd>
            <dt class="self-start text-muted-foreground">
              {{ t("panel.follow.card.search") }}
            </dt>
            <dd class="grid gap-0.5">
              <template v-if="details">
                <span v-if="details.searchRequested" class="text-info">
                  {{ t("panel.follow.card.searchRequested") }}
                </span>
                <span
                  v-else-if="details.lastSearchAt"
                  :title="formatDateTime(details.lastSearchAt, locale)"
                >
                  {{
                    t("panel.follow.card.searchLast", {
                      time: relative(details.lastSearchAt),
                    })
                  }}
                </span>
                <span v-else>{{ t("panel.follow.card.searchNever") }}</span>
                <span
                  v-if="
                    shown.state === 'active'
                      && details.nextSearchAt
                      && !details.searchRequested
                  "
                  class="text-[12.5px] text-muted-foreground"
                  :title="formatDateTime(details.nextSearchAt, locale)"
                >
                  {{
                    t("panel.follow.card.searchNext", {
                      time: relative(details.nextSearchAt),
                    })
                  }}
                </span>
              </template>
              <Skeleton v-else-if="detailsLoading" class="h-4 w-40" />
              <span v-else class="text-muted-foreground">—</span>
            </dd>
          </dl>

          <!-- Подробности грузятся отдельно: правила видны сразу из строки списка -->
          <FollowRulesForm :follow="details ?? shown" />

          <section class="grid gap-2">
            <div>
              <h3 class="text-xs font-medium text-muted-foreground">
                {{
                  t(
                    shown.kind === "movie"
                      ? "panel.follow.card.movie"
                      : "panel.follow.card.episodes",
                  )
                }}
              </h3>
              <p class="mt-0.5 text-[12.5px] text-muted-foreground">
                {{ t("panel.follow.card.episodesHint") }}
              </p>
            </div>
            <div
              v-if="detailsLoading && !details"
              class="grid gap-px overflow-hidden rounded-lg border"
              aria-busy="true"
            >
              <div
                v-for="row in 4"
                :key="row"
                class="flex h-10 items-center gap-3 px-3"
              >
                <Skeleton class="h-3 w-12" />
                <Skeleton class="h-3 w-28" />
              </div>
            </div>
            <div
              v-else-if="detailsState === 'error' && !details"
              class="grid justify-items-center gap-2 rounded-lg border px-3 py-5 text-center text-[13px]"
              role="alert"
            >
              <CircleAlertIcon
                class="size-4 text-destructive"
                aria-hidden="true"
              />
              <p class="text-muted-foreground">
                {{ t("panel.follow.card.loadError") }}
              </p>
              <Button variant="outline" size="sm" @click="loadDetails">
                <RefreshCwIcon aria-hidden="true" />
                {{ t("panel.common.retry") }}
              </Button>
            </div>
            <FollowEpisodes v-else-if="details" :details="details" />
          </section>
        </div>

        <footer class="flex shrink-0 flex-wrap gap-2 border-t p-3">
          <LoadingButton
            size="sm"
            :loading="isSearching"
            :disabled="
              isBusy || shown.state !== 'active' || !!details?.searchRequested
            "
            @click="onSearch"
          >
            <SearchIcon aria-hidden="true" />
            {{ t("panel.follow.actions.searchNow") }}
          </LoadingButton>
          <Button
            v-if="shown.state === 'active' || shown.state === 'paused'"
            variant="outline"
            size="sm"
            :disabled="isBusy"
            @click="actions.togglePause(shown)"
          >
            <component
              :is="isPaused ? PlayIcon : PauseIcon"
              aria-hidden="true"
            />
            {{
              t(
                isPaused
                  ? "panel.follow.actions.resume"
                  : "panel.follow.actions.pause",
              )
            }}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            class="ml-auto"
            @click="emit('delete')"
          >
            {{ t("panel.follow.actions.delete") }}
          </Button>
        </footer>
      </template>
    </SheetContent>
  </Sheet>
</template>
