<script setup lang="ts">
import type { Library, LibraryFileItem } from '@torsher/api-client'
import { PencilIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import LoadingButton from '~/components/LoadingButton.vue'
import { dialogSheetClass } from '~/lib/dialog'
import { api } from '~/services/api'

/**
 * Видео домашней библиотеки и их даты съёмки: откуда взята дата (теги, имя,
 * время файла) и ручная правка. Дата «как на часах камеры» — без пересчёта зоны
 */
const props = defineProps<{
  library: Library | null
}>()

const open = defineModel<boolean>('open', { required: true })

const PAGE = 50

const { t, locale } = useI18n()
const items = shallowRef<LibraryFileItem[]>([])
const total = ref(0)
const loading = ref(false)
const editing = ref<string | null>(null)
const draft = ref('')
const saving = ref(false)

async function load(more = false) {
  if (!props.library)
    return

  loading.value = true

  try {
    const page = await api.libraries.getLibraryFiles(props.library.id, {
      offset: more ? items.value.length : 0,
      limit: PAGE,
    })

    items.value = more ? [...items.value, ...page.items] : page.items
    total.value = page.total
  }
  finally {
    loading.value = false
  }
}

watch(open, (isOpen) => {
  if (isOpen) {
    items.value = []
    editing.value = null
    void load()
  }
})

function nameOf(item: LibraryFileItem) {
  return item.relPath.slice(item.relPath.lastIndexOf('/') + 1)
}

// Дата «как на часах камеры» хранится в UTC-компонентах: показываем в UTC
function dateOf(item: LibraryFileItem) {
  if (!item.capturedAt)
    return t('panel.library.files.noDate')

  return new Date(item.capturedAt).toLocaleString(
    locale.value.replace('_', '-'),
    {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short',
    },
  )
}

function edit(item: LibraryFileItem) {
  editing.value = item.id
  draft.value = item.capturedAt?.slice(0, 16) ?? ''
}

async function save(item: LibraryFileItem, value: string | null) {
  saving.value = true

  try {
    await api.libraries.patchLibraryFile(item.id, {
      capturedAt: value ? `${value}:00.000Z` : null,
    })
    editing.value = null
    toast.success(t('panel.library.files.saved'))
    await load()
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>{{ t("panel.library.files.title") }}</DialogTitle>
        <DialogDescription>{{ library?.name }}</DialogDescription>
      </DialogHeader>

      <div class="max-h-[60vh] overflow-y-auto rounded-lg border">
        <div
          v-if="loading && !items.length"
          class="grid gap-1 p-2"
          aria-busy="true"
        >
          <Skeleton v-for="item in 5" :key="item" class="h-12 rounded" />
        </div>
        <p
          v-else-if="!items.length"
          class="p-4 text-[13px] text-muted-foreground"
        >
          {{ t("panel.library.files.empty") }}
        </p>
        <ul v-else class="divide-y">
          <li
            v-for="item in items"
            :key="item.id"
            class="grid gap-2 px-3 py-2.5"
          >
            <div class="flex items-center gap-3">
              <span class="grid min-w-0 flex-1">
                <span class="truncate font-mono text-xs" :title="item.relPath">
                  {{ nameOf(item) }}
                </span>
                <span class="text-[12.5px] text-muted-foreground tabular-nums">
                  {{ dateOf(item) }}
                  <template v-if="item.capturedAtSource">
                    ·
                    {{
                      t(`panel.library.files.sources.${item.capturedAtSource}`)
                    }}
                  </template>
                </span>
              </span>
              <Button
                v-if="editing !== item.id"
                variant="ghost"
                size="icon-sm"
                :aria-label="t('panel.library.files.edit')"
                @click="edit(item)"
              >
                <PencilIcon aria-hidden="true" />
              </Button>
            </div>
            <div
              v-if="editing === item.id"
              class="flex flex-wrap items-center gap-2"
            >
              <Input
                v-model="draft"
                type="datetime-local"
                class="w-auto font-mono text-xs"
              />
              <LoadingButton
                size="sm"
                :loading="saving"
                :disabled="!draft"
                @click="save(item, draft)"
              >
                {{ t("panel.common.save") }}
              </LoadingButton>
              <Button
                v-if="item.capturedAtSource === 'user'"
                size="sm"
                variant="ghost"
                :disabled="saving"
                @click="save(item, null)"
              >
                {{ t("panel.library.files.auto") }}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                :disabled="saving"
                @click="editing = null"
              >
                {{ t("panel.common.cancel") }}
              </Button>
            </div>
          </li>
        </ul>
      </div>

      <Button
        v-if="items.length < total"
        variant="outline"
        :disabled="loading"
        @click="load(true)"
      >
        {{ t("panel.library.files.more", { n: total - items.length }) }}
      </Button>
    </DialogContent>
  </Dialog>
</template>
