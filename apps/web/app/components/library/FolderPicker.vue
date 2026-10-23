<script setup lang="ts">
import type { FolderBrowse } from '@torsher/api-client'
import { ArrowUpIcon, FolderIcon, FolderOpenIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '~/services/api'

/**
 * Путь папки на сервере: ввод вручную или обзор ФС сервера (в образе — пути
 * внутри контейнера). Обзор раскрывается под полем, список постоянной высоты
 */
defineProps<{
  id: string
  invalid?: boolean
  describedby?: string
}>()

const path = defineModel<string | undefined>({ required: true })

const { t } = useI18n()
const browsing = ref(false)
const listing = shallowRef<FolderBrowse | null>(null)
const loading = ref(false)
const failed = ref(false)

async function browse(target?: string) {
  loading.value = true
  failed.value = false

  try {
    listing.value = await withErrorMode('silent', () =>
      api.libraries.getLibraryBrowse({ path: target || undefined }))
  }
  catch {
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
        placeholder="/media/video"
        :aria-invalid="invalid || undefined"
        :aria-describedby="describedby"
      />
      <Button type="button" variant="outline" @click="toggle">
        <FolderOpenIcon aria-hidden="true" />
        {{ t("panel.library.picker.browse") }}
      </Button>
    </div>

    <div v-if="browsing" class="grid min-w-0 gap-2 rounded-lg border p-2">
      <div class="flex min-w-0 items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          :disabled="!listing?.parent || loading"
          :aria-label="t('panel.library.picker.up')"
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
          type="button"
          size="sm"
          :disabled="!listing || loading"
          @click="choose"
        >
          {{ t("panel.library.picker.choose") }}
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
          {{ t("panel.library.picker.failed") }}
        </p>
        <p
          v-else-if="!listing?.entries.length"
          class="p-3 text-[13px] text-muted-foreground"
        >
          {{ t("panel.library.picker.empty") }}
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
