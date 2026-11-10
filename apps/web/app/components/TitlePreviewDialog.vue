<script setup lang="ts">
import type { Card, TitleDetails } from '@torsher/api-client'
import { CircleAlertIcon, FilmIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { dialogSheetClass } from '~/lib/dialog'
import { cn } from '~/lib/utils'
import { api } from '~/services/api'

const props = defineProps<{ card: Card }>()
const emit = defineEmits<{ select: [id: string] }>()

const { t, locale } = useI18n()
const previewClass = cn(
  dialogSheetClass,
  'grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl max-sm:h-dvh max-sm:max-h-dvh max-sm:rounded-none',
)
const open = ref(false)
const details = shallowRef<TitleDetails | null>(null)
const pending = ref(false)
const failed = ref(false)
const attempt = ref(0)
const loading = useHeldLoading(() => pending.value)
const title = computed(() => details.value ?? props.card)
const metadata = computed(() =>
  [
    title.value.year,
    t(
      title.value.kind === 'movie'
        ? 'panel.torrents.match.movie'
        : 'panel.torrents.match.series',
    ),
    title.value.originalTitle !== title.value.title
      ? title.value.originalTitle
      : '',
  ]
    .filter(Boolean)
    .join(' · '),
)

watch([open, locale, attempt], async ([isOpen], _, onCleanup) => {
  if (!isOpen)
    return

  const controller = new AbortController()
  onCleanup(() => {
    controller.abort()
    pending.value = false
  })
  details.value = null
  failed.value = false
  pending.value = true

  try {
    const found = await withErrorMode('silent', () =>
      api.catalog.getAdminCatalogTitle(
        props.card.id,
        {
          language: locale.value.replace('_', '-'),
        },
        { signal: controller.signal },
      ))

    if (!controller.signal.aborted)
      details.value = found
  }
  catch {
    if (!controller.signal.aborted)
      failed.value = true
  }
  finally {
    if (!controller.signal.aborted)
      pending.value = false
  }
})

function select() {
  emit('select', props.card.id)
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <slot />
    </DialogTrigger>
    <DialogContent :class="previewClass">
      <DialogHeader class="min-w-0 pr-8">
        <DialogTitle class="break-words">
          {{ title.title }}
        </DialogTitle>
        <DialogDescription class="break-words">
          {{ metadata }}
        </DialogDescription>
      </DialogHeader>

      <div
        class="grid min-h-0 auto-rows-max content-start gap-5 overflow-y-auto sm:grid-cols-[180px_minmax(0,1fr)]"
      >
        <div
          class="grid aspect-[2/3] w-40 place-items-center self-start justify-self-center overflow-hidden rounded-lg bg-muted text-muted-foreground sm:w-full"
          aria-hidden="true"
        >
          <img
            v-if="title.poster"
            :src="title.poster"
            alt=""
            class="size-full object-cover"
          >
          <FilmIcon v-else class="size-10" />
        </div>
        <div class="min-w-0 space-y-4">
          <div v-if="loading" class="space-y-3" aria-busy="true">
            <Skeleton class="h-4 w-2/3" />
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-3/4" />
          </div>
          <div v-else-if="failed" class="space-y-3">
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>
                {{ t("panel.titlePreview.failed") }}
              </AlertDescription>
            </Alert>
            <Button variant="outline" size="sm" @click="attempt++">
              {{ t("panel.common.retry") }}
            </Button>
          </div>
          <template v-else-if="details">
            <p
              v-if="details.genres.length"
              class="text-xs text-muted-foreground"
            >
              {{ details.genres.join(" · ") }}
            </p>
            <p
              class="whitespace-pre-line break-words leading-relaxed"
              :class="{ 'text-muted-foreground': !details.overview }"
            >
              {{ details.overview || t("panel.titlePreview.noOverview") }}
            </p>
          </template>
        </div>
      </div>

      <DialogFooter>
        <Button @click="select">
          {{ t("panel.titlePreview.select") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
