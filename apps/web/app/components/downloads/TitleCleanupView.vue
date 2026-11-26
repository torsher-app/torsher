<script setup lang="ts">
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  HardDriveDownloadIcon,
  LibraryIcon,
  SearchIcon,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import PageBar from '~/components/shell/PageBar.vue'
import {
  TITLE_CLEANUP_LIMIT,
  useTitleCleanup,
} from '~/composables/useTitleCleanup'
import { formatBytes } from '~/lib/format'
import TitleCleanupDialog from './TitleCleanupDialog.vue'

const { t, locale } = useI18n()
const {
  items,
  selected,
  state,
  previewOpen,
  preview,
  result,
  previewError,
  actionError,
  previewing,
  executing,
  confirmation,
  load,
  toggle,
  openPreview,
  refreshPreview,
  excludeFromPreview,
  execute,
  retryOperations,
} = useTitleCleanup()

const search = ref('')
const loading = useHeldLoading(() => state.value === 'loading')
const visible = computed(() => {
  const tag = locale.value.replace('_', '-')
  const query = search.value.trim().toLocaleLowerCase(tag)
  return items.value.filter(item =>
    item.name.toLocaleLowerCase(tag).includes(query),
  )
})
const bytes = (size: number) => formatBytes(size, locale.value)

onMounted(load)
</script>

<template>
  <PageBar
    :title="t('panel.torrents.cleanup.title')"
    :parent="t('panel.nav.torrents')"
    parent-to="/downloads"
  >
    <template #actions>
      <Button as-child variant="ghost" size="icon-sm" class="md:hidden">
        <NuxtLink to="/downloads" :aria-label="t('common.back')">
          <ArrowLeftIcon aria-hidden="true" />
        </NuxtLink>
      </Button>
    </template>
  </PageBar>

  <div class="min-h-0 flex-1 overflow-y-auto">
    <section
      class="mx-auto grid w-full max-w-[880px] content-start gap-4 p-4 md:p-6"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="relative w-full sm:max-w-xs">
          <SearchIcon
            class="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            v-model="search"
            type="search"
            class="w-full pl-9"
            :placeholder="t('panel.torrents.cleanup.search')"
            :aria-label="t('panel.torrents.cleanup.search')"
          />
        </div>

        <div class="flex w-full items-center justify-between gap-3 sm:w-auto">
          <span
            class="text-sm text-muted-foreground tabular-nums"
            aria-live="polite"
          >
            {{ t("panel.collections.titles", selected.size) }}
          </span>
          <Button
            size="sm"
            :disabled="
              !selected.size || previewing || executing || state !== 'ready'
            "
            @click="openPreview"
          >
            {{ t("panel.maintenance.preview") }}
          </Button>
        </div>
      </div>

      <ul v-if="loading" class="divide-y rounded-lg border" aria-busy="true">
        <li
          v-for="row in 5"
          :key="row"
          class="flex min-h-14 items-center gap-4 px-4"
        >
          <Skeleton class="size-4" />
          <Skeleton class="h-4 w-2/5" />
        </li>
      </ul>

      <Alert v-else-if="state === 'error'" variant="destructive">
        <CircleAlertIcon />
        <AlertDescription class="flex flex-wrap items-center gap-3">
          {{ t("panel.torrents.loadError") }}
          <Button variant="outline" size="sm" @click="load">
            {{ t("panel.common.retry") }}
          </Button>
        </AlertDescription>
      </Alert>

      <p
        v-else-if="!visible.length"
        class="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground"
      >
        {{
          search.trim()
            ? t("panel.maintenance.noMatches")
            : t("panel.torrents.cleanup.empty")
        }}
      </p>

      <ul v-else class="divide-y rounded-lg border">
        <li
          v-for="item in visible"
          :key="item.id"
          class="flex min-h-14 items-center gap-3 px-4 py-2.5"
        >
          <Checkbox
            :id="`disk-cleanup-${item.id}`"
            :model-value="selected.has(item.id)"
            :disabled="
              selected.size >= TITLE_CLEANUP_LIMIT && !selected.has(item.id)
            "
            @update:model-value="(checked) => toggle(item.id, checked === true)"
          />
          <label
            :for="`disk-cleanup-${item.id}`"
            class="flex min-w-0 flex-1 cursor-pointer flex-wrap items-center justify-between gap-x-3 gap-y-1"
          >
            <span class="min-w-0 break-words text-sm font-medium">{{
              item.name
            }}</span>
            <span
              class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums"
            >
              <span
                v-if="item.libraryBytes > 0"
                class="inline-flex items-center gap-1.5"
              >
                <LibraryIcon aria-hidden="true" class="size-3.5" />
                <span class="sr-only">{{ t("panel.nav.library") }}</span>
                {{ bytes(item.libraryBytes) }}
              </span>
              <span
                v-if="item.downloadBytes !== null && item.downloadBytes > 0"
                class="inline-flex items-center gap-1.5"
              >
                <HardDriveDownloadIcon aria-hidden="true" class="size-3.5" />
                <span class="sr-only">{{ t("panel.nav.torrents") }}</span>
                {{ bytes(item.downloadBytes) }}
              </span>
            </span>
          </label>
        </li>
      </ul>
    </section>
  </div>

  <TitleCleanupDialog
    v-model:open="previewOpen"
    :preview="preview"
    :result="result"
    :loading="previewing"
    :executing="executing"
    :preview-error="previewError"
    :action-error="actionError"
    :can-delete="confirmation.length > 0"
    @refresh="refreshPreview"
    @exclude="excludeFromPreview"
    @execute="execute"
    @retry="retryOperations"
  />
</template>
