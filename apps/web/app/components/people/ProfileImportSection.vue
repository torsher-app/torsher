<script setup lang="ts">
import type { Profile } from '@torsher/api-client'
import { ChevronRightIcon, FileUpIcon, RefreshCwIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
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
import { Skeleton } from '@/components/ui/skeleton'
import LoadingButton from '~/components/LoadingButton.vue'
import {
  undoImportRun,
  useProfileImports,
} from '~/composables/useProfileImports'
import { dialogSheetClass } from '~/lib/dialog'
import { formatDate } from '~/lib/format'
import ImportRatingsDialog from './ImportRatingsDialog.vue'

/**
 * Блок карточки профиля: импорт своих оценок из файлов других сервисов,
 * последний импорт с отменой и ссылка на несопоставленное.
 */
const props = defineProps<{
  profile: Profile
}>()

const { t, locale } = useI18n()
const { overview, state, load } = useProfileImports(() => props.profile.id)

const dialogOpen = ref(false)
const undoOpen = ref(false)
const undoing = ref(false)

const job = computed(() => overview.value?.job ?? null)
const last = computed(() => overview.value?.last ?? null)

async function onUndo() {
  if (!last.value)
    return

  undoing.value = true

  try {
    const undone = await undoImportRun(props.profile.id, last.value.id)

    toast.success(t('panel.imports.toasts.undone'), {
      description: undone.kept
        ? t('panel.imports.toasts.undoneKept', undone.kept)
        : undefined,
    })
    undoOpen.value = false
  }
  catch {
    toast.error(t('panel.imports.errors.undoFailed'))
  }
  finally {
    undoing.value = false
    void load()
  }
}
</script>

<template>
  <section class="grid gap-2" :aria-label="t('panel.imports.section')">
    <div class="flex items-center justify-between gap-3">
      <h3 class="text-[13.5px] font-medium">
        {{ t("panel.imports.section") }}
      </h3>
      <Button variant="outline" size="xs" @click="dialogOpen = true">
        <FileUpIcon aria-hidden="true" />
        {{ t(job ? "panel.imports.open" : "panel.imports.start") }}
      </Button>
    </div>

    <!-- Одна строка состояния постоянной высоты: загрузка не двигает блок -->
    <div
      class="flex min-h-5 items-center gap-2 text-[13px] text-muted-foreground"
    >
      <Skeleton v-if="state === 'loading'" class="h-3.5 w-3/5" />
      <template v-else-if="state === 'error'">
        {{ t("panel.imports.loadError") }}
        <Button variant="outline" size="xs" @click="load">
          <RefreshCwIcon aria-hidden="true" />
          {{ t("panel.common.retry") }}
        </Button>
      </template>
      <span
        v-else-if="job?.state === 'matching'"
        class="tabular-nums"
        aria-live="polite"
      >
        {{
          t("panel.imports.matching", {
            done: job.progress.done,
            total: job.progress.total,
          })
        }}
      </span>
      <span v-else-if="job?.state === 'ready'">
        {{ t("panel.imports.ready") }}
      </span>
      <span v-else-if="job?.state === 'failed'">
        {{ t("panel.imports.failed") }}
      </span>
      <template v-else-if="last">
        <span class="min-w-0 truncate">
          {{
            t("panel.imports.last", {
              date: formatDate(last.appliedAt, locale),
              count: t("panel.imports.titles", last.summary.imported),
            })
          }}
        </span>
        <Button
          v-if="last.canUndo"
          variant="link"
          size="xs"
          class="h-auto px-0"
          @click="undoOpen = true"
        >
          {{ t("panel.imports.undo") }}
        </Button>
      </template>
      <span v-else>{{ t("panel.imports.hint") }}</span>
    </div>

    <NuxtLink
      v-if="overview && overview.unmatched > 0"
      :to="`/people/${profile.id}/import`"
      class="inline-flex w-fit items-center gap-0.5 text-[12.5px] text-muted-foreground hover:text-foreground"
    >
      {{ t("panel.imports.unmatchedLink", { n: overview.unmatched }) }}
      <ChevronRightIcon class="size-3.5" aria-hidden="true" />
    </NuxtLink>

    <ImportRatingsDialog
      v-model:open="dialogOpen"
      :profile-id="profile.id"
      :profile-name="profile.name"
      :job="job"
      @changed="load"
    />

    <AlertDialog v-model:open="undoOpen">
      <AlertDialogContent :class="dialogSheetClass">
        <AlertDialogHeader class="place-items-start text-left">
          <AlertDialogTitle>
            {{
              t("panel.imports.undoDialog.title")
            }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{ t("panel.imports.undoDialog.text") }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="undoing">
            {{ t("panel.imports.undoDialog.keep") }}
          </AlertDialogCancel>
          <LoadingButton
            variant="destructive"
            :loading="undoing"
            @click="onUndo"
          >
            {{ t("panel.imports.undoDialog.submit") }}
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>
