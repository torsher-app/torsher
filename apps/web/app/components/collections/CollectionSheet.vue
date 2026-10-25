<script setup lang="ts">
import type { Card, Collection } from '@torsher/api-client'
import { PencilIcon, RefreshCwIcon, XIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { keepOpenOnListClick } from '~/lib/sheet'

const props = defineProps<{
  collection: Collection | null
}>()

const emit = defineEmits<{
  close: []
  edit: []
  delete: []
}>()

const { t, locale } = useI18n()
const { titlesOf, removeTitle } = useCollections()

const shown = useLastValue(() => props.collection)
const titles = shallowRef<Card[]>([])
const state = ref<'loading' | 'error' | 'ready'>('loading')
// Карточка живёт и закрытой: время скелетона идёт от выбора подборки
const loading = useHeldLoading(
  () => !!props.collection && state.value === 'loading',
)
const removing = ref<string>()
let token = 0

async function load() {
  const current = props.collection

  if (!current)
    return

  const mine = ++token

  // Пустая подборка: пустое состояние сразу, без запроса
  if (current.count === 0) {
    titles.value = []
    state.value = 'ready'
    return
  }

  state.value = 'loading'

  try {
    const items = await titlesOf(current.id, locale.value.replace('_', '-'))

    if (mine !== token)
      return

    titles.value = items
    state.value = 'ready'
  }
  catch {
    if (mine === token)
      state.value = 'error'
  }
}

watch(
  () => props.collection?.id,
  (id) => {
    if (id)
      void load()
  },
  { immediate: true },
)

async function onRemove(card: Card) {
  const current = props.collection

  if (!current)
    return

  removing.value = card.id

  try {
    await removeTitle(current.id, card.id)
    titles.value = titles.value.filter(item => item.id !== card.id)
  }
  catch {
    toast.error(t('panel.collections.toasts.removeFailed'))
  }
  finally {
    removing.value = undefined
  }
}

// Строка списка переключает карточку, пустое место под строками закрывает её
function onInteractOutside(event: Event) {
  keepOpenOnListClick(event, '[data-collections-list]')
}
</script>

<template>
  <Sheet
    :open="!!collection"
    :modal="false"
    @update:open="(isOpen) => !isOpen && emit('close')"
  >
    <SheetContent
      side="right"
      :show-close-button="false"
      class="gap-0 bg-background p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[440px] md:data-[side=right]:inset-y-2 md:data-[side=right]:right-2 md:data-[side=right]:h-auto md:rounded-r-xl md:border"
      @interact-outside="onInteractOutside"
    >
      <template v-if="shown">
        <header
          class="flex h-12 shrink-0 items-center gap-2 border-b pr-2 pl-4"
        >
          <SheetTitle class="min-w-0 flex-1 truncate text-[15px] font-semibold">
            {{ shown.name }}
          </SheetTitle>
          <SheetDescription class="sr-only">
            {{ t("panel.collections.titles", shown.count) }}
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

        <div class="min-h-0 flex-1 overflow-y-auto">
          <ul v-if="loading" aria-busy="true">
            <li
              v-for="row in Math.min(Math.max(shown.count, 1), 6)"
              :key="row"
              class="flex h-17 items-center gap-3 border-b px-4"
            >
              <Skeleton class="h-12 w-8 rounded-sm" />
              <div class="grid flex-1 gap-1.5">
                <Skeleton class="h-3.5 w-2/5" />
                <Skeleton class="h-3 w-1/5" />
              </div>
            </li>
          </ul>

          <div
            v-else-if="state === 'error'"
            class="grid justify-items-start gap-3 p-4 text-[13.5px]"
            role="alert"
          >
            <p class="text-muted-foreground">
              {{ t("panel.collections.titlesError") }}
            </p>
            <Button variant="outline" size="sm" @click="load">
              <RefreshCwIcon aria-hidden="true" />
              {{ t("panel.common.retry") }}
            </Button>
          </div>

          <p
            v-else-if="titles.length === 0"
            class="p-4 text-[13.5px] text-muted-foreground"
          >
            {{ t("panel.collections.titlesEmpty") }}
          </p>

          <ul v-else>
            <li
              v-for="card in titles"
              :key="card.id"
              class="flex h-17 items-center gap-3 border-b pr-2.5 pl-4 text-[13.5px]"
            >
              <span
                class="h-12 w-8 shrink-0 overflow-hidden rounded-sm bg-muted"
              >
                <img
                  v-if="card.poster"
                  :src="card.poster"
                  alt=""
                  class="size-full object-cover"
                  loading="lazy"
                  decoding="async"
                >
              </span>
              <span class="grid min-w-0 flex-1">
                <span class="truncate font-medium">{{ card.title }}</span>
                <span class="truncate text-[12.5px] text-muted-foreground">
                  {{
                    [card.year, t(`panel.collections.kinds.${card.kind}`)]
                      .filter(Boolean)
                      .join(" · ")
                  }}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                :disabled="removing === card.id"
                @click="onRemove(card)"
              >
                {{ t("panel.collections.removeTitle") }}
              </Button>
            </li>
          </ul>
        </div>

        <footer class="flex shrink-0 flex-wrap gap-2 border-t p-3">
          <Button variant="outline" size="sm" @click="emit('edit')">
            <PencilIcon aria-hidden="true" />
            {{ t("panel.collections.edit") }}
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
