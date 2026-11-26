<script setup lang="ts">
import type {
  TitleCleanupPreview,
  TitleCleanupResult,
} from '@torsher/api-client'
import { CircleAlertIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import LoadingButton from '~/components/LoadingButton.vue'
import { dialogSheetClass } from '~/lib/dialog'
import { formatBytes } from '~/lib/format'

const props = defineProps<{
  preview?: TitleCleanupPreview
  result?: TitleCleanupResult
  loading: boolean
  executing: boolean
  previewError: boolean
  actionError: boolean
  canDelete: boolean
}>()
const emit = defineEmits<{
  refresh: []
  execute: []
  exclude: [id: string]
  retry: [ids: string[]]
}>()
const open = defineModel<boolean>('open', { required: true })
const { t, locale } = useI18n()
const bytes = (size: number) => formatBytes(size, locale.value)

const statuses = computed(
  () => new Map(props.result?.items.map(item => [item.id, item.status])),
)
const retryIds = computed(
  () => props.result?.items.flatMap(item => item.operationIds) ?? [],
)
const groups = [
  { kind: 'library', label: 'panel.nav.library' },
  { kind: 'download', label: 'panel.nav.torrents' },
] as const
const reasonText = {
  busy: 'panel.maintenance.conflict',
  private: 'panel.torrents.privatePolicy.protected',
  conflict: 'panel.maintenance.conflict',
  unavailable: 'panel.torrents.errorTitles.unknown',
  missing: 'panel.maintenance.noMatches',
} as const
const resultText = {
  deleted: 'panel.torrents.deleteDialog.deletedFiles',
  stale: 'panel.maintenance.conflict',
  blocked: 'panel.maintenance.conflict',
  partial: 'panel.maintenance.pending',
} as const
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent
      class="grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden data-[size=default]:sm:max-w-2xl"
      :class="[dialogSheetClass]"
      @escape-key-down="
        (event) => {
          if (executing || loading) event.preventDefault();
        }
      "
    >
      <AlertDialogHeader class="place-items-start text-left">
        <AlertDialogTitle>
          {{
            t("panel.torrents.cleanup.title")
          }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("panel.torrents.cleanup.confirm") }}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div
        class="min-h-0 space-y-4 overflow-y-auto pr-1"
        :aria-busy="loading || executing"
      >
        <div v-if="loading" class="space-y-3">
          <Skeleton class="h-5 w-44" />
          <Skeleton class="h-16 w-full" />
          <Skeleton class="h-16 w-full" />
        </div>

        <Alert v-if="previewError || actionError" variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>
            {{
              t("panel.maintenance.error")
            }}
          </AlertDescription>
        </Alert>

        <template v-if="preview">
          <p v-if="!result" class="text-sm font-medium tabular-nums">
            {{
              preview.reclaimableBytes === null
                ? t("panel.torrents.cleanup.unknownEstimate")
                : t("panel.torrents.cleanup.estimate", {
                  size: bytes(preview.reclaimableBytes),
                })
            }}
          </p>
          <ul class="divide-y rounded-lg border">
            <li
              v-for="item in preview.items"
              :key="item.id"
              class="space-y-2 px-3 py-3"
            >
              <div class="flex min-w-0 items-center gap-3">
                <Checkbox
                  v-if="item.reason && !result"
                  :model-value="true"
                  :aria-labelledby="`cleanup-preview-title-${item.id}`"
                  @update:model-value="
                    (checked) => {
                      if (checked === false) emit('exclude', item.id);
                    }
                  "
                />
                <h3
                  :id="`cleanup-preview-title-${item.id}`"
                  class="min-w-0 break-words text-sm font-semibold"
                >
                  {{ item.name }}
                </h3>
              </div>
              <p
                v-if="statuses.has(item.id)"
                class="text-sm text-muted-foreground"
                role="status"
              >
                {{ t(resultText[statuses.get(item.id)!]) }}
              </p>
              <p
                v-else-if="result && actionError"
                class="text-sm text-muted-foreground"
              >
                {{ t("panel.maintenance.pending") }}
              </p>
              <p v-else-if="item.reason" class="text-sm text-muted-foreground">
                {{ t(reasonText[item.reason]) }}
              </p>
              <template v-if="!result">
                <div v-for="group in groups" :key="group.kind">
                  <template
                    v-if="
                      item.files.some((file) => file.kind === group.kind)
                        || (group.kind === 'download' && item.downloads.length)
                    "
                  >
                    <h4 class="text-xs font-medium text-muted-foreground">
                      {{ t(group.label) }}
                    </h4>
                    <ul
                      v-if="group.kind === 'download' && item.downloads.length"
                      class="mb-1 space-y-0.5 text-sm"
                    >
                      <li
                        v-for="download in item.downloads"
                        :key="download.id"
                        class="break-words"
                      >
                        {{ download.name }}
                      </li>
                    </ul>
                    <ul class="divide-y text-xs">
                      <li
                        v-for="(file, index) in item.files.filter(
                          (file) => file.kind === group.kind,
                        )"
                        :key="`${file.path}:${index}`"
                        class="flex flex-wrap justify-between gap-x-3 gap-y-0.5 py-1"
                      >
                        <span class="min-w-0 break-all font-mono">{{
                          file.path
                        }}</span>
                        <span
                          class="shrink-0 text-muted-foreground tabular-nums"
                        >{{ bytes(file.size) }}</span>
                      </li>
                    </ul>
                  </template>
                </div>
              </template>
            </li>
          </ul>
        </template>
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel :disabled="executing || loading">
          {{ t(result ? "panel.common.close" : "panel.common.cancel") }}
        </AlertDialogCancel>
        <LoadingButton
          v-if="result && retryIds.length"
          :loading="executing"
          @click="emit('retry', retryIds)"
        >
          {{ t("panel.common.retry") }}
        </LoadingButton>
        <Button
          v-else-if="previewError || (actionError && !result)"
          variant="outline"
          @click="emit('refresh')"
        >
          {{ t("panel.maintenance.preview") }}
        </Button>
        <LoadingButton
          v-else-if="!result"
          variant="destructive"
          :loading="executing"
          :disabled="!canDelete || loading"
          @click="emit('execute')"
        >
          {{ t("panel.torrents.deleteDialog.withFiles") }}
        </LoadingButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
