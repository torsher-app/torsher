<script setup lang="ts">
import type { TorrentErrorKind } from '~/composables/useTorrents'
import { CircleAlertIcon } from '@lucide/vue'
import { parseRelease } from '@torsher/release-parser'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import LoadingButton from '~/components/LoadingButton.vue'
import TitleSearch from '~/components/TitleSearch.vue'
import { torrentErrorKind } from '~/composables/useTorrents'
import { dialogSheetClass } from '~/lib/dialog'

export interface PreviewFile {
  id: string
  relPath: string
  season: number | null
  episode: number | null
  episodeTo: number | null
}

export interface EpisodeFix {
  id: string
  season: number
  // null — файл не серия: останется в «Без описания»
  episode: number | null
  episodeTo?: number | null
}

/**
 * «Исправить совпадение»: поиск по каталогу с названием и годом из имени,
 * выбор тайтла или «Не фильм и не сериал». Что сохранять — решает вызывающий:
 * раздача в «Загрузках» или папка-релиз библиотеки. С `preview` у сериала
 * второй шаг — как файлы лягут по сериям, номер можно поправить у каждого
 */
const props = defineProps<{
  // Имя раздачи или папки как есть; null — диалог закрыт
  name: string | null
  // Отмеченный кандидат при открытии: текущий тайтл или подсказка
  current: string | null
  save: (titleId: string | null, episodes?: EpisodeFix[]) => Promise<void>
  preview?: (titleId: string) => Promise<PreviewFile[]>
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()

const query = ref('')
const chosen = ref<string>('')
const saving = ref<'save' | 'ignore' | 'preview' | null>(null)
const step = ref<'search' | 'episodes'>('search')

interface EpisodeDraft {
  id: string
  name: string
  season: string
  episode: string
  episodeTo: number | null
}

const drafts = ref<EpisodeDraft[]>([])

// Шаг «Серии» есть у сериала, когда вызывающий умеет показать раскладку
const withEpisodes = computed(
  () => !!props.preview && chosen.value.startsWith('tmdb:tv:'),
)
const error = ref<TorrentErrorKind | null>(null)

// Поиск открывается с названием и годом из имени — как их понял сервер
function initialQuery(value: string) {
  const parsed = parseRelease(value)
  const name = parsed.titles.ru ?? parsed.titles.orig ?? parsed.titles.translit

  return [name ?? value, parsed.year].filter(Boolean).join(' ')
}

watch(open, (isOpen) => {
  if (!isOpen || !props.name)
    return

  error.value = null
  saving.value = null
  step.value = 'search'
  drafts.value = []
  chosen.value = props.current ?? ''
  query.value = initialQuery(props.name)
})

async function showEpisodes() {
  if (!props.preview)
    return

  saving.value = 'preview'
  error.value = null

  try {
    const files = await props.preview(chosen.value)

    drafts.value = files.map(file => ({
      id: file.id,
      name: file.relPath.slice(file.relPath.lastIndexOf('/') + 1),
      season: file.season === null ? '' : String(file.season),
      episode: file.episode === null ? '' : String(file.episode),
      episodeTo: file.episodeTo,
    }))
    step.value = 'episodes'
  }
  catch (err) {
    error.value = await torrentErrorKind(err)
  }
  finally {
    saving.value = null
  }
}

// Пустой номер серии — файл не серия; сезон без номера — нулевой (спецвыпуски)
function episodesOf(): EpisodeFix[] {
  return drafts.value.map((draft) => {
    const episode = Number.parseInt(draft.episode, 10)

    return {
      id: draft.id,
      season: Number.parseInt(draft.season, 10) || 0,
      episode: Number.isFinite(episode) && episode > 0 ? episode : null,
      episodeTo: draft.episodeTo,
    }
  })
}

async function save(titleId: string | null) {
  if (!props.name)
    return

  saving.value = titleId ? 'save' : 'ignore'
  error.value = null

  try {
    // Тост — у вызывающего: раздача и папка библиотеки говорят по-разному
    await props.save(
      titleId,
      titleId && step.value === 'episodes' ? episodesOf() : undefined,
    )
    open.value = false
  }
  catch (err) {
    error.value = await torrentErrorKind(err)
  }
  finally {
    saving.value = null
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>{{ t("panel.torrents.match.title") }}</DialogTitle>
        <DialogDescription class="font-mono text-xs break-all">
          {{ name }}
        </DialogDescription>
      </DialogHeader>

      <div v-if="step === 'episodes'" class="grid gap-2">
        <p class="text-[13px] text-muted-foreground">
          {{ t("panel.library.episodes.text") }}
        </p>
        <!-- Та же высота, что у результатов поиска: шаг не двигает кнопки -->
        <div class="h-[336px] overflow-y-auto rounded-lg border">
          <div
            class="sticky top-0 grid grid-cols-[minmax(0,1fr)_64px_64px] gap-2 border-b bg-background px-3 py-2 text-xs text-muted-foreground"
          >
            <span>{{ t("panel.library.episodes.file") }}</span>
            <span>{{ t("panel.library.episodes.season") }}</span>
            <span>{{ t("panel.library.episodes.episode") }}</span>
          </div>
          <div
            v-for="draft in drafts"
            :key="draft.id"
            class="grid grid-cols-[minmax(0,1fr)_64px_64px] items-center gap-2 px-3 py-1.5"
          >
            <span class="truncate font-mono text-xs" :title="draft.name">{{
              draft.name
            }}</span>
            <Input
              v-model="draft.season"
              type="number"
              min="0"
              inputmode="numeric"
              class="h-8 px-2 tabular-nums"
              :aria-label="
                t('panel.library.episodes.seasonOf', { name: draft.name })
              "
            />
            <Input
              v-model="draft.episode"
              type="number"
              min="1"
              inputmode="numeric"
              class="h-8 px-2 tabular-nums"
              placeholder="—"
              :aria-label="
                t('panel.library.episodes.episodeOf', { name: draft.name })
              "
            />
          </div>
        </div>
      </div>

      <div v-else class="grid gap-3">
        <TitleSearch
          v-model:query="query"
          v-model:chosen="chosen"
          input-id="match-query"
          :label="t('panel.torrents.match.search')"
        />

        <Alert v-if="error" variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>
            {{ t(`panel.torrents.errorTitles.${error}`) }}
          </AlertTitle>
          <AlertDescription>
            {{ t(`panel.torrents.errors.${error}`) }}
          </AlertDescription>
        </Alert>
      </div>

      <Alert v-if="error && step === 'episodes'" variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>{{ t(`panel.torrents.errorTitles.${error}`) }}</AlertTitle>
        <AlertDescription>
          {{ t(`panel.torrents.errors.${error}`) }}
        </AlertDescription>
      </Alert>

      <DialogFooter class="sm:justify-between">
        <Button
          v-if="step === 'episodes'"
          variant="ghost"
          :disabled="!!saving"
          @click="step = 'search'"
        >
          {{ t("panel.library.episodes.back") }}
        </Button>
        <LoadingButton
          v-else
          variant="ghost"
          :loading="saving === 'ignore'"
          :disabled="!!saving"
          @click="save(null)"
        >
          {{ t("panel.torrents.match.notTitle") }}
        </LoadingButton>
        <div class="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" :disabled="!!saving" @click="open = false">
            {{ t("panel.common.cancel") }}
          </Button>
          <LoadingButton
            v-if="withEpisodes && step === 'search'"
            :loading="saving === 'preview'"
            :disabled="!chosen || !!saving"
            @click="showEpisodes"
          >
            {{ t("panel.library.episodes.next") }}
          </LoadingButton>
          <LoadingButton
            v-else
            :loading="saving === 'save'"
            :disabled="!chosen || !!saving"
            @click="save(chosen)"
          >
            {{ t("panel.common.save") }}
          </LoadingButton>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
