<script setup lang="ts">
import type { FolderBrowse } from '@torsher/api-client'
import { ArrowUpIcon, FolderIcon, FolderOpenIcon } from '@lucide/vue'
import { useDebounceFn } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '~/services/api'

/**
 * Путь папки на сервере: ввод вручную или обзор ФС сервера (в образе — пути
 * внутри контейнера). Обзор раскрывается под полем, список постоянной высоты.
 * `follow` — обзор открыт сразу, и переход в папку выбирает её: так выбирают
 * папки хранения, проверка идёт на каждом шаге
 */
const props = defineProps<{
  id: string
  invalid?: boolean
  describedby?: string
  follow?: boolean
  placeholder?: string
}>()

const path = defineModel<string | undefined>({ required: true })

const TYPED_BROWSE_DELAY_MS = 400

const { t } = useI18n()
const browsing = ref(false)
const listing = shallowRef<FolderBrowse | null>(null)
const loading = ref(false)
const failed = ref(false)

function parentOf(target: string) {
  return target.replace(/\/[^/]+\/?$/, '') || '/'
}

/**
 * Открывает папку в обзоре; в режиме `follow` переход выбирает её. Папки ещё
 * нет (она создастся) — обзор открывает ближайшую существующую выше, а путь
 * остаётся введённым
 */
async function browse(target = '/', select = props.follow) {
  loading.value = true
  failed.value = false

  try {
    listing.value = await withErrorMode('silent', () =>
      api.storage.getStorageBrowse({ path: target }))

    if (select)
      path.value = listing.value.path
  }
  catch {
    if (props.follow && target !== '/') {
      await browse(parentOf(target), false)
      return
    }

    failed.value = true
  }
  finally {
    loading.value = false
  }
}

function toggle() {
  browsing.value = !browsing.value

  if (browsing.value)
    void browse(path.value?.trim() || '/')
}

// Введённый руками путь открывается в обзоре сам: заголовок списка не
// расходится с полем
const browseTyped = useDebounceFn((value: string) => {
  if (value.startsWith('/') && value !== listing.value?.path)
    void browse(value, false)
}, TYPED_BROWSE_DELAY_MS)

watch(path, (value) => {
  if (props.follow)
    void browseTyped(value?.trim() ?? '')
})

onMounted(() => {
  if (props.follow) {
    browsing.value = true
    void browse(path.value?.trim() || '/', false)
  }
})

// В обзоре Enter открывает введённый путь, а не отправляет форму
function onEnter(event: KeyboardEvent) {
  if (!props.follow)
    return

  event.preventDefault()
  void browse(path.value?.trim() || '/', false)
}

function choose() {
  if (listing.value) {
    path.value = listing.value.path
    browsing.value = false
  }
}
</script>

<template>
  <!-- min-w-0: длинный путь сокращается, а не распирает диалог -->
  <div class="grid min-w-0 gap-2">
    <div class="flex min-w-0 gap-2">
      <Input
        :id="id"
        v-model="path"
        autocomplete="off"
        spellcheck="false"
        class="font-mono text-xs"
        :placeholder="placeholder ?? '/media/video'"
        :aria-invalid="invalid || undefined"
        :aria-describedby="describedby"
        @keydown.enter="onEnter"
      />
      <Button v-if="!follow" type="button" variant="outline" @click="toggle">
        <FolderOpenIcon aria-hidden="true" />
        {{ t("panel.folderPicker.browse") }}
      </Button>
    </div>

    <div v-if="browsing" class="grid min-w-0 gap-2 rounded-lg border p-2">
      <div class="flex min-w-0 items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          :disabled="!listing?.parent || loading"
          :aria-label="t('panel.folderPicker.up')"
          @click="browse(listing?.parent ?? '/')"
        >
          <ArrowUpIcon aria-hidden="true" />
        </Button>
        <span
          class="min-w-0 flex-1 truncate font-mono text-xs"
          :title="listing?.path"
        >
          {{ listing?.path ?? "/" }}
        </span>
        <Button
          v-if="!follow"
          type="button"
          size="sm"
          :disabled="!listing || loading"
          @click="choose"
        >
          {{ t("panel.folderPicker.choose") }}
        </Button>
      </div>
      <!-- Список постоянной высоты: переходы по папкам не двигают диалог -->
      <div class="h-[200px] overflow-y-auto rounded-md bg-muted/40">
        <div
          v-if="loading && !listing"
          class="grid gap-1 p-1.5"
          aria-busy="true"
        >
          <Skeleton v-for="item in 5" :key="item" class="h-7 rounded" />
        </div>
        <p v-else-if="failed" class="p-3 text-[13px] text-muted-foreground">
          {{ t("panel.folderPicker.failed") }}
        </p>
        <p
          v-else-if="!listing?.entries.length"
          class="p-3 text-[13px] text-muted-foreground"
        >
          {{ t("panel.folderPicker.empty") }}
        </p>
        <ul v-else class="grid p-1">
          <li v-for="entry in listing.entries" :key="entry.path">
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              @click="browse(entry.path)"
            >
              <FolderIcon
                class="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span class="truncate">{{ entry.name }}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
