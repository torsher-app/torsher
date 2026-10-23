<script setup lang="ts">
import type {
  Library,
  LibraryFolder,
  UnmatchedGroup,
} from '@torsher/api-client'
import type { EpisodeFix } from './FixMatchDialog.vue'
import { CircleAlertIcon, PlusIcon } from '@lucide/vue'
import { useNow } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Card, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import LoadingButton from '~/components/LoadingButton.vue'
import PageBar from '~/components/shell/PageBar.vue'
import { dialogSheetClass } from '~/lib/dialog'
import AddFolderDialog from './AddFolderDialog.vue'
import AddLibraryDialog from './AddLibraryDialog.vue'
import FixMatchDialog from './FixMatchDialog.vue'
import { api } from '~/services/api'
import LibraryCard from './LibraryCard.vue'
import LibraryFilesDialog from './LibraryFilesDialog.vue'
import LibrarySettingsDialog from './LibrarySettingsDialog.vue'
import UnmatchedRow from './UnmatchedRow.vue'

const { t } = useI18n()
const {
  libraries,
  unmatched,
  state,
  load,
  stopPolling,
  remove,
  removeFolder,
  scan,
  setGroupTitle,
} = useLibraries()
const now = useNow({ interval: 30_000 })

// Своя раскладка Torsher — первой: она всегда есть и не удаляется
const ordered = computed(() =>
  [...libraries.value].sort((a, b) => Number(b.managed) - Number(a.managed)),
)

const isAddOpen = ref(false)
const folderTarget = ref<Library | null>(null)
const settingsTarget = ref<Library | null>(null)
const filesTarget = ref<Library | null>(null)
const matchTarget = ref<UnmatchedGroup | null>(null)
const busyGroup = ref<string | null>(null)

// Подтверждение удаления: библиотеки целиком или одной папки
const removal = ref<
  | { kind: 'library', library: Library }
  | { kind: 'folder', folder: LibraryFolder }
  | null
>(null)
const removing = ref(false)

function modelOf<T>(target: Ref<T | null>) {
  return computed({
    get: () => !!target.value,
    set: (isOpen: boolean) => {
      if (!isOpen)
        target.value = null
    },
  })
}

const isFolderOpen = modelOf(folderTarget)
const isSettingsOpen = modelOf(settingsTarget)
const isFilesOpen = modelOf(filesTarget)
const isMatchOpen = modelOf(matchTarget)
const isRemovalOpen = modelOf(removal)

async function onScan(folder: LibraryFolder) {
  await scan(folder.id)
  toast.success(t('panel.library.toasts.scanning'), {
    description: folder.path,
  })
}

async function confirmRemoval() {
  const target = removal.value

  if (!target)
    return

  removing.value = true

  try {
    if (target.kind === 'library')
      await remove(target.library.id)
    else await removeFolder(target.folder.id)

    removal.value = null
    toast.success(t(`panel.library.remove.done.${target.kind}`))
  }
  finally {
    removing.value = false
  }
}

// Раскладка релиза по сериям выбранного сериала: шаг «Серии» в диалоге
async function previewMatch(titleId: string) {
  const group = matchTarget.value

  if (!group)
    return []

  const preview = await api.libraries.getLibraryGroupPreview({
    folderId: group.folderId,
    group: group.group,
    titleId,
  })

  return preview.items
}

async function confirmMatch(group: UnmatchedGroup, titleId: string) {
  busyGroup.value = `${group.folderId}:${group.group}`

  try {
    await setGroupTitle(group, titleId)
    toast.success(t('panel.library.unmatched.saved'), {
      description: group.name,
    })
  }
  finally {
    busyGroup.value = null
  }
}

async function saveMatch(titleId: string | null, episodes?: EpisodeFix[]) {
  const group = matchTarget.value

  if (!group)
    return

  await setGroupTitle(group, titleId, episodes)
  toast.success(
    t(
      titleId
        ? 'panel.library.unmatched.saved'
        : 'panel.library.unmatched.ignored',
    ),
    { description: group.name },
  )
}

onMounted(load)
onBeforeUnmount(stopPolling)
</script>

<template>
  <PageBar :title="t('panel.nav.library')">
    <template v-if="state === 'ready'" #actions>
      <Button size="sm" @click="isAddOpen = true">
        <PlusIcon aria-hidden="true" />
        <span class="max-sm:sr-only">{{ t("panel.library.add.title") }}</span>
      </Button>
    </template>
  </PageBar>

  <div class="mx-auto grid w-full max-w-[880px] gap-5 p-4 md:p-6">
    <div
      v-if="state === 'loading' && !libraries.length"
      class="grid gap-4"
      aria-busy="true"
    >
      <Skeleton v-for="item in 2" :key="item" class="h-36 rounded-xl" />
    </div>

    <Alert v-else-if="state === 'error'" variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>{{ t("panel.library.loadFailed") }}</AlertTitle>
      <AlertDescription class="flex flex-wrap items-center gap-3">
        {{ t("panel.library.loadFailedText") }}
        <Button size="sm" variant="outline" @click="load">
          {{ t("panel.common.retry") }}
        </Button>
      </AlertDescription>
    </Alert>

    <template v-else>
      <!-- Нераспознанное — первым: это требует ответа владельца -->
      <Card v-if="unmatched.length" class="gap-0 py-0">
        <div class="px-5 pt-4 pb-3">
          <CardTitle class="text-base font-semibold tracking-tight">
            {{ t("panel.library.unmatched.title") }}
            <span class="ml-1 text-muted-foreground tabular-nums">{{
              unmatched.length
            }}</span>
          </CardTitle>
          <p class="text-[13px] text-muted-foreground">
            {{ t("panel.library.unmatched.text") }}
          </p>
        </div>
        <ul class="divide-y border-t">
          <UnmatchedRow
            v-for="group in unmatched"
            :key="`${group.folderId}:${group.group}`"
            :group="group"
            :busy="busyGroup === `${group.folderId}:${group.group}`"
            @confirm="(titleId) => confirmMatch(group, titleId)"
            @fix="matchTarget = group"
          />
        </ul>
      </Card>

      <LibraryCard
        v-for="library in ordered"
        :key="library.id"
        :library="library"
        :now="now.getTime()"
        @add-folder="folderTarget = library"
        @settings="settingsTarget = library"
        @files="filesTarget = library"
        @remove="removal = { kind: 'library', library }"
        @scan="onScan"
        @remove-folder="(folder) => (removal = { kind: 'folder', folder })"
      />

      <p v-if="libraries.length <= 1" class="text-[13px] text-muted-foreground">
        {{ t("panel.library.emptyHint") }}
      </p>
    </template>
  </div>

  <AddLibraryDialog v-model:open="isAddOpen" />
  <AddFolderDialog v-model:open="isFolderOpen" :library="folderTarget" />
  <LibrarySettingsDialog
    v-model:open="isSettingsOpen"
    :library="settingsTarget"
  />
  <LibraryFilesDialog v-model:open="isFilesOpen" :library="filesTarget" />
  <FixMatchDialog
    v-model:open="isMatchOpen"
    :name="matchTarget?.name ?? null"
    :current="matchTarget?.suggestion ?? null"
    :save="saveMatch"
    :preview="previewMatch"
  />

  <AlertDialog v-model:open="isRemovalOpen">
    <AlertDialogContent :class="dialogSheetClass">
      <AlertDialogHeader class="place-items-start text-left">
        <AlertDialogTitle>
          {{ t(`panel.library.remove.title.${removal?.kind ?? "folder"}`) }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t(`panel.library.remove.text.${removal?.kind ?? "folder"}`) }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="removing">
          {{ t("panel.common.cancel") }}
        </AlertDialogCancel>
        <LoadingButton
          variant="destructive"
          :loading="removing"
          @click="confirmRemoval"
        >
          {{ t(`panel.library.remove.submit.${removal?.kind ?? "folder"}`) }}
        </LoadingButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
