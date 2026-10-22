<script setup lang="ts">
import type { Torrent } from '@torsher/api-client'
import {
  ArrowDownToLineIcon,
  CircleXIcon,
  FileIcon,
  FilmIcon,
  MonitorPlayIcon,
  PinIcon,
  PinOffIcon,
  TriangleAlertIcon,
  XIcon,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import LoadingButton from '~/components/LoadingButton.vue'
import { formatDateTime, formatRelative } from '~/lib/format'
import { releaseMetaOf } from '~/lib/releaseMeta'
import { playerUrl } from '~/lib/torrents'
import DownloadStatusIcon from './DownloadStatusIcon.vue'

const props = defineProps<{
  torrent: Torrent | null
  now: number
}>()

const emit = defineEmits<{
  close: []
  delete: []
}>()

const { t, locale } = useI18n()
const { tvUrl } = useRuntimeConfig().public
const status = useDownloadStatus()
const actions = useDownloadActions()

// Пока лист уезжает, в нём остаётся последняя раздача, а не пустота
const shown = shallowRef<Torrent | null>(props.torrent)
const title = useTitleInfo(() => shown.value?.titleId ?? null)
// Выбор файлов в карточке — черновик до «Скачать выбранные»
const selection = ref(new Set<number>())

function resetSelection(torrent: Torrent) {
  selection.value = new Set(
    torrent.files.filter(file => file.selected).map(file => file.index),
  )
}

watch(
  () => props.torrent,
  (torrent, previous) => {
    if (!torrent)
      return

    shown.value = torrent

    if (torrent.id !== previous?.id)
      resetSelection(torrent)
  },
  { immediate: true },
)

const view = computed(() => (shown.value ? status.viewOf(shown.value) : null))
const label = computed(() => (view.value ? status.label(view.value) : ''))
const problem = computed(() => (view.value ? status.problem(view.value) : ''))
const selected = computed(() =>
  shown.value ? status.selected(shown.value) : null,
)
const release = computed(() =>
  shown.value ? releaseMetaOf(shown.value) : null,
)
const isBusy = computed(() => !!shown.value && actions.isBusy(shown.value.id))

const isSelectionChanged = computed(() => {
  const torrent = shown.value

  if (!torrent)
    return false

  const current = torrent.files
    .filter(file => file.selected)
    .map(file => file.index)

  return (
    current.length !== selection.value.size
    || current.some(index => !selection.value.has(index))
  )
})

// Уже качается целиком то, что выбрано, — повторно «Скачать» не нужно
const canDownload = computed(
  () =>
    shown.value?.status === 'ready'
    && selection.value.size > 0
    && (isSelectionChanged.value
      || shown.value.state === 'idle'
      || shown.value.state === 'partial'),
)

function toggleFile(index: number, checked: boolean | 'indeterminate') {
  const next = new Set(selection.value)

  if (checked === true)
    next.add(index)
  else next.delete(index)

  selection.value = next
}

async function onDownload() {
  if (shown.value) {
    await actions.download(
      shown.value,
      [...selection.value].sort((a, b) => a - b),
    )
  }
}

function filePercent(downloaded: number, size: number) {
  return size > 0 ? Math.floor((downloaded / size) * 100) : 0
}

// Список под карточкой остаётся живым: клик по другой строке переключает карточку
function onInteractOutside(event: Event) {
  const target = event.target as HTMLElement | null

  if (target?.closest('[data-downloads-list]'))
    event.preventDefault()
}
</script>

<template>
  <Sheet
    :open="!!torrent"
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
          <DownloadStatusIcon :view="view" :label="label" />
          <SheetTitle class="min-w-0 flex-1 truncate text-[15px] font-semibold">
            {{ title?.title ?? shown.name }}
          </SheetTitle>
          <SheetDescription class="sr-only">
            {{ label }}
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
          <Alert
            v-if="problem"
            :variant="view.tone === 'destructive' ? 'destructive' : 'warning'"
          >
            <CircleXIcon v-if="view.tone === 'destructive'" />
            <TriangleAlertIcon v-else />
            <AlertTitle>{{ label }}</AlertTitle>
            <AlertDescription>
              {{ problem }}
              <NuxtLink
                v-if="view.status === 'pausedStorage'"
                to="/settings/storage"
                class="mt-1 block font-medium text-foreground underline underline-offset-3"
              >
                {{ t("panel.torrents.storageLink") }}
              </NuxtLink>
            </AlertDescription>
          </Alert>

          <dl
            class="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-[13.5px]"
          >
            <dt class="text-muted-foreground">
              {{ t("panel.torrents.card.status") }}
            </dt>
            <dd class="flex flex-wrap items-center gap-2">
              <Badge :variant="view.badge">
                {{ label }}
              </Badge>
              <span class="text-muted-foreground tabular-nums">
                {{ status.numbers(shown, view) }}
              </span>
            </dd>
            <template v-if="title">
              <dt class="text-muted-foreground">
                {{ t("panel.torrents.card.title") }}
              </dt>
              <dd>
                {{ [title.title, title.year].filter(Boolean).join(", ") }}
              </dd>
            </template>
            <dt class="text-muted-foreground">
              {{ t("panel.torrents.card.size") }}
            </dt>
            <dd class="tabular-nums">
              {{
                [
                  release?.episodes,
                  release?.quality,
                  status.bytes(shown.totalSize),
                ]
                  .filter(Boolean)
                  .join(" · ")
              }}
            </dd>
            <dt class="text-muted-foreground">
              {{ t("panel.torrents.card.wanted") }}
            </dt>
            <dd class="tabular-nums">
              {{
                selected
                  ? `${selected.count} · ${status.bytes(selected.size)}`
                  : t("panel.torrents.card.wantedNone")
              }}
            </dd>
            <dt class="text-muted-foreground">
              {{ t("panel.torrents.card.onDisk") }}
            </dt>
            <dd class="tabular-nums">
              {{ status.bytes(shown.sizeOnDisk) }}
            </dd>
            <template v-if="shown.state !== 'idle'">
              <dt class="text-muted-foreground">
                {{ t("panel.torrents.card.speed") }}
              </dt>
              <dd class="tabular-nums">
                ↓ {{ status.speed(shown.downloadSpeed) }} · ↑
                {{ status.speed(shown.uploadSpeed) }}
              </dd>
              <dt class="text-muted-foreground">
                {{ t("panel.torrents.card.peers") }}
              </dt>
              <dd class="tabular-nums">
                {{ t("panel.torrents.card.peersValue", shown.peers) }}
              </dd>
            </template>
            <dt class="self-start text-muted-foreground">
              {{ t("panel.torrents.card.storage") }}
            </dt>
            <dd>
              {{
                t(
                  shown.retention === "keep"
                    ? "panel.torrents.card.storageKeep"
                    : "panel.torrents.card.storageCache",
                )
              }}
            </dd>
            <dt class="text-muted-foreground">
              {{ t("panel.torrents.card.added") }}
            </dt>
            <dd :title="formatDateTime(shown.addedAt, locale)">
              {{ formatRelative(shown.addedAt, locale, now) }}
            </dd>
            <dt class="text-muted-foreground">
              {{ t("panel.torrents.card.watched") }}
            </dt>
            <dd
              :title="
                shown.lastAccessAt
                  ? formatDateTime(shown.lastAccessAt, locale)
                  : undefined
              "
            >
              {{
                shown.lastAccessAt
                  ? formatRelative(shown.lastAccessAt, locale, now)
                  : t("panel.torrents.card.never")
              }}
            </dd>
          </dl>

          <section v-if="shown.status === 'ready'" class="grid gap-2">
            <div>
              <h3 class="text-xs font-medium text-muted-foreground">
                {{ t("panel.torrents.card.files") }}
              </h3>
              <p class="mt-0.5 text-[12.5px] text-muted-foreground">
                {{ t("panel.torrents.card.filesHint") }}
              </p>
            </div>
            <ul class="grid rounded-lg border">
              <li
                v-for="file in shown.files"
                :key="file.index"
                class="grid grid-cols-[16px_16px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 border-b px-3 py-2 text-[13px] last:border-b-0"
              >
                <Checkbox
                  :id="`download-file-${file.index}`"
                  :model-value="selection.has(file.index)"
                  :aria-label="
                    t('panel.torrents.selectFile', { name: file.path })
                  "
                  @update:model-value="
                    (checked) => toggleFile(file.index, checked)
                  "
                />
                <component
                  :is="file.isVideo ? FilmIcon : FileIcon"
                  class="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <label
                  :for="`download-file-${file.index}`"
                  class="min-w-0 truncate"
                  :class="{ 'text-muted-foreground': !file.isVideo }"
                  :title="file.path"
                >
                  <span
                    v-if="release?.fileEpisodes.get(file.index)"
                    class="mr-1.5 font-medium tabular-nums"
                  >{{ release.fileEpisodes.get(file.index) }}</span>{{ file.path }}
                </label>
                <span class="flex items-center justify-end">
                  <Button
                    v-if="file.isVideo"
                    as="a"
                    variant="ghost"
                    size="icon-sm"
                    class="size-7"
                    :href="playerUrl(tvUrl, shown.id, file.index)"
                    target="_blank"
                    rel="noopener"
                    :aria-label="
                      t('panel.torrents.openFile', { name: file.path })
                    "
                  >
                    <MonitorPlayIcon />
                  </Button>
                </span>
                <span
                  class="col-start-3 text-xs text-muted-foreground tabular-nums"
                >
                  {{ status.bytes(file.size) }}
                  <template v-if="file.downloaded > 0">
                    ·
                    {{
                      t("panel.torrents.percent", {
                        value: filePercent(file.downloaded, file.size),
                      })
                    }}
                  </template>
                </span>
              </li>
            </ul>
          </section>
        </div>

        <footer class="flex shrink-0 flex-wrap gap-2 border-t p-3">
          <LoadingButton
            v-if="shown.status === 'ready'"
            size="sm"
            :loading="isBusy"
            :disabled="!canDownload"
            @click="onDownload"
          >
            <ArrowDownToLineIcon aria-hidden="true" />
            {{ t("panel.torrents.download") }}
          </LoadingButton>
          <Button
            v-if="shown.status === 'ready'"
            variant="outline"
            size="sm"
            :disabled="isBusy"
            @click="actions.toggleKeep(shown)"
          >
            <component
              :is="shown.retention === 'keep' ? PinOffIcon : PinIcon"
              aria-hidden="true"
            />
            {{
              t(
                shown.retention === "keep"
                  ? "panel.torrents.unkeep"
                  : "panel.torrents.keep",
              )
            }}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            class="ml-auto"
            @click="emit('delete')"
          >
            {{ t("panel.common.delete") }}
          </Button>
        </footer>
      </template>
    </SheetContent>
  </Sheet>
</template>
