<script setup lang="ts">
import type { Card } from '@torsher/api-client'
import { FilmIcon, SearchIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '~/services/api'

/**
 * Поиск тайтла по каталогу с выбором одного результата. Ищет сразу при
 * появлении — с тем запросом, что задал вызывающий, — и дальше по вводу.
 */
defineProps<{
  inputId: string
  label: string
}>()

const query = defineModel<string>('query', { required: true })
const chosen = defineModel<string>('chosen', { required: true })

const SEARCH_DELAY_MS = 300
const RESULT_LIMIT = 8

const { t, locale } = useI18n()

const results = shallowRef<Card[]>([])
const searching = ref(false)
const searchFailed = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
let run = 0

async function search(value: string) {
  const current = ++run
  const text = value.trim()

  if (!text) {
    results.value = []
    searching.value = false
    return
  }

  searching.value = true
  searchFailed.value = false

  try {
    const found = await withErrorMode('silent', () =>
      api.catalog.getCatalogSearch({
        query: text,
        language: locale.value.replace('_', '-'),
      }))

    if (current === run)
      results.value = found.items.slice(0, RESULT_LIMIT)
  }
  catch {
    if (current === run) {
      results.value = []
      searchFailed.value = true
    }
  }
  finally {
    if (current === run)
      searching.value = false
  }
}

onMounted(() => void search(query.value))

watch(query, (value) => {
  clearTimeout(timer)
  timer = setTimeout(search, SEARCH_DELAY_MS, value)
})

onBeforeUnmount(() => clearTimeout(timer))

function kindLabel(card: Card) {
  return t(
    card.kind === 'movie'
      ? 'panel.torrents.match.movie'
      : 'panel.torrents.match.series',
  )
}
</script>

<template>
  <div class="grid gap-3">
    <div class="grid gap-2">
      <Label :for="inputId">{{ label }}</Label>
      <div class="relative">
        <SearchIcon
          class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          :id="inputId"
          v-model="query"
          autocomplete="off"
          spellcheck="false"
          class="pl-8"
        />
      </div>
    </div>

    <!-- Список постоянной высоты: результаты не двигают кнопки диалога -->
    <div class="h-[312px] overflow-y-auto rounded-lg border">
      <div
        v-if="searching && !results.length"
        class="grid gap-px p-1.5"
        aria-busy="true"
      >
        <Skeleton v-for="item in 4" :key="item" class="h-[60px] rounded-md" />
      </div>
      <p
        v-else-if="searchFailed || !results.length"
        class="p-4 text-[13px] text-muted-foreground"
      >
        {{
          t(
            searchFailed
              ? "panel.torrents.match.searchFailed"
              : "panel.torrents.match.empty",
          )
        }}
      </p>
      <RadioGroup v-else v-model="chosen" class="gap-0 p-1.5">
        <Label
          v-for="card in results"
          :key="card.id"
          :for="`${inputId}-${card.id}`"
          class="grid cursor-pointer grid-cols-[16px_40px_minmax(0,1fr)] items-center gap-3 rounded-md px-2 py-1.5 font-normal hover:bg-muted/60 has-[[data-state=checked]]:bg-muted"
        >
          <RadioGroupItem :id="`${inputId}-${card.id}`" :value="card.id" />
          <span
            class="grid h-[48px] w-[32px] place-items-center overflow-hidden rounded bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            <img
              v-if="card.poster"
              :src="card.poster"
              alt=""
              class="size-full object-cover"
              loading="lazy"
            >
            <FilmIcon v-else class="size-3.5" />
          </span>
          <span class="grid min-w-0">
            <span class="truncate font-medium">{{ card.title }}</span>
            <span class="truncate text-xs text-muted-foreground tabular-nums">
              {{
                [
                  card.year,
                  kindLabel(card),
                  card.originalTitle !== card.title ? card.originalTitle : "",
                ]
                  .filter(Boolean)
                  .join(" · ")
              }}
            </span>
          </span>
        </Label>
      </RadioGroup>
    </div>
  </div>
</template>
