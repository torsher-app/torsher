<script setup lang="ts">
import type {
  BackupItem,
  ServerImportPreview,
  ServerImportResult,
} from '@torsher/api-client'
import type { RestoreOutcome } from '~/composables/useRestoreFlow'
import {
  CircleAlertIcon,
  FileUpIcon,
  InfoIcon,
  KeyRoundIcon,
  XIcon,
} from '@lucide/vue'
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
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import LoadingButton from '~/components/LoadingButton.vue'
import SecretInput from '~/components/SecretInput.vue'
import {
  applyTransfer,
  MAX_EXPORT_BYTES,
  previewTransfer,
  TransferBackupError,
  TransferFileError,
} from '~/composables/useTransfer'
import { backupErrorText, formatDayTime } from '~/lib/backups'
import { dialogSheetClass } from '~/lib/dialog'
import { formatBytes } from '~/lib/format'
import BackupRestoreDialog from './BackupRestoreDialog.vue'

/**
 * Импорт экспорта другого сервера Torsher: файл → предпросмотр с
 * сопоставлением профилей → итог. Перед записью сервер делает копию
 * `pre-import`, и «Отменить импорт» восстанавливает её.
 */
const emit = defineEmits<{
  restored: [outcome: Extract<RestoreOutcome, { kind: 'finished' }>]
}>()

const open = defineModel<boolean>('open', { required: true })

type Step = 'file' | 'preview' | 'result'
type Policy = 'keep' | 'replace' | 'newer'

const { t, locale } = useI18n()
const { profiles, state: profilesState, load: loadProfiles } = useProfiles()
const { status, refresh: refreshBackups } = useBackups()

const base = 'panel.transfer.import'

const step = ref<Step>('file')
const file = shallowRef<File | null>(null)
const password = ref('')
const preview = shallowRef<ServerImportPreview | null>(null)
const result = shallowRef<ServerImportResult | null>(null)
const mapping = ref<Record<string, string>>({})
const conflicts = ref<Policy>('newer')
const fileError = ref<string | null>(null)
const applyError = ref<string | null>(null)
const busy = ref<'preview' | 'apply' | null>(null)
const dragging = ref(false)
const restoreOpen = ref(false)

watch(open, (value) => {
  if (!value)
    return

  step.value = 'file'
  file.value = null
  password.value = ''
  preview.value = null
  result.value = null
  fileError.value = null
  applyError.value = null

  if (profilesState.value === 'idle')
    void loadProfiles()
})

function suggested(target: ServerImportPreview['profiles'][number]['target']) {
  return target.kind === 'existing' ? target.id : target.kind
}

function pick(list: FileList | null | undefined) {
  const next = list?.[0]

  if (!next)
    return

  fileError.value = null
  file.value = next.size > MAX_EXPORT_BYTES ? null : next

  if (!file.value)
    fileError.value = t(`${base}.errors.tooLarge`)
}

function onPick(event: Event) {
  const input = event.target as HTMLInputElement

  pick(input.files)
  input.value = ''
}

function onDrop(event: DragEvent) {
  dragging.value = false
  pick(event.dataTransfer?.files)
}

async function runPreview() {
  if (!file.value) {
    fileError.value = t(`${base}.errors.noFile`)
    return
  }

  busy.value = 'preview'
  fileError.value = null

  try {
    const next = await previewTransfer(file.value, password.value)

    preview.value = next
    mapping.value = Object.fromEntries(
      next.profiles.map(profile => [profile.key, suggested(profile.target)]),
    )
    step.value = 'preview'
  }
  catch (err) {
    fileError.value = t(
      `${base}.errors.${err instanceof TransferFileError ? err.kind : 'unknown'}`,
    )
    step.value = 'file'
  }
  finally {
    busy.value = null
  }
}

async function onApply() {
  if (!preview.value)
    return

  busy.value = 'apply'
  applyError.value = null

  try {
    result.value = await applyTransfer({
      token: preview.value.token,
      mapping: mapping.value,
      conflicts: conflicts.value,
    })
    step.value = 'result'
    // Фоновое обновление: полная загрузка спрятала бы страницу за скелетоном
    // вместе с этим диалогом
    void refreshBackups()
  }
  catch (err) {
    applyError.value
      = err instanceof TransferBackupError && err.body
        ? t(`${base}.errors.backup`, {
            reason: backupErrorText(t, locale.value, {
              kind: err.body.kind,
              params: err.body.params,
            }),
          })
        : t(`${base}.errors.applyFailed`)
  }
  finally {
    busy.value = null
  }
}

// Копия перед импортом из списка копий: по ней импорт и отменяется
const backupItem = computed<BackupItem | null>(() => {
  const name = result.value?.backup

  return (
    (name && status.value?.items.find(item => item.name === name)) || null
  )
})

function onUndo() {
  if (backupItem.value)
    restoreOpen.value = true
}

function changed(key: string) {
  const profile = preview.value?.profiles.find(item => item.key === key)

  return !!profile && mapping.value[key] !== suggested(profile.target)
}

const settingsTotal = computed(() => {
  const settings = preview.value?.settings

  return settings
    ? settings.routes.new
    + settings.managers.new
    + settings.indexers.new
    + settings.channels.new
    + (settings.tmdbKey ? 1 : 0)
    : 0
})

const policies: Policy[] = ['newer', 'keep', 'replace']
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>{{ t(`${base}.title`) }}</DialogTitle>
        <DialogDescription>{{ t(`${base}.description`) }}</DialogDescription>
      </DialogHeader>

      <!-- Шаг 1: файл -->
      <form
        v-if="step === 'file'"
        id="transfer-import-file"
        class="grid gap-4"
        novalidate
        @submit.prevent="runPreview"
      >
        <Alert v-if="fileError" variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{{ t(`${base}.errors.title`) }}</AlertTitle>
          <AlertDescription>{{ fileError }}</AlertDescription>
        </Alert>

        <div class="grid gap-2">
          <Label for="transfer-import-input" class="sr-only">
            {{ t(`${base}.file`) }}
          </Label>
          <label
            class="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center transition-colors hover:bg-muted/40 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
            :class="{ 'border-primary bg-muted/40': dragging }"
            @dragenter.prevent="dragging = true"
            @dragover.prevent="dragging = true"
            @dragleave.prevent="dragging = false"
            @drop.prevent="onDrop"
          >
            <FileUpIcon
              class="size-5 text-muted-foreground"
              aria-hidden="true"
            />
            <span class="text-[13.5px] font-medium">{{
              t(`${base}.drop`)
            }}</span>
            <span class="text-[12.5px] text-muted-foreground">
              {{ t(`${base}.dropHint`) }}
            </span>
            <input
              id="transfer-import-input"
              type="file"
              accept=".json,.gz,application/json,application/gzip"
              class="sr-only"
              @change="onPick"
            >
          </label>
        </div>

        <!-- Строка файла есть всегда: выбор файла не меняет высоту окна -->
        <div
          class="flex h-11 items-center gap-2 rounded-lg border pr-1.5 pl-3 text-[13px]"
        >
          <template v-if="file">
            <span class="min-w-0 flex-1 truncate font-mono text-xs">
              {{ file.name }}
            </span>
            <span class="shrink-0 text-xs text-muted-foreground tabular-nums">
              {{ formatBytes(file.size, locale) }}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              :aria-label="t(`${base}.remove`, { name: file.name })"
              @click="file = null"
            >
              <XIcon />
            </Button>
          </template>
          <span v-else class="flex-1 text-muted-foreground">
            {{ t(`${base}.noFile`) }}
          </span>
        </div>

        <div class="grid gap-1.5">
          <Label for="transfer-import-password">
            {{ t(`${base}.password`) }}
            <span class="font-normal text-muted-foreground">
              {{ t("panel.common.optional") }}
            </span>
          </Label>
          <SecretInput
            id="transfer-import-password"
            v-model="password"
            autocomplete="off"
            :show-label="t('panel.auth.showPassword')"
            :hide-label="t('panel.auth.hidePassword')"
          />
          <p class="text-[12.5px] text-muted-foreground">
            {{ t(`${base}.passwordHint`) }}
          </p>
        </div>
      </form>

      <!-- Шаг 2: предпросмотр -->
      <div v-else-if="step === 'preview' && preview" class="grid gap-4">
        <p class="text-[12.5px] text-muted-foreground">
          {{
            t(`${base}.from`, {
              date: formatDayTime(preview.exportedAt, locale),
              version: preview.version,
            })
          }}
        </p>

        <Alert
          v-if="preview.secrets === 'locked' || preview.secrets === 'wrong'"
          :variant="preview.secrets === 'wrong' ? 'destructive' : 'info'"
        >
          <KeyRoundIcon />
          <AlertTitle>{{ t(`${base}.secrets.${preview.secrets}`) }}</AlertTitle>
          <AlertDescription class="grid gap-2">
            <span>{{ t(`${base}.secrets.text`) }}</span>
            <form
              class="flex flex-wrap items-center gap-2"
              novalidate
              @submit.prevent="runPreview"
            >
              <SecretInput
                v-model="password"
                class="w-56"
                autocomplete="off"
                :aria-label="t(`${base}.password`)"
                :show-label="t('panel.auth.showPassword')"
                :hide-label="t('panel.auth.hidePassword')"
              />
              <LoadingButton
                type="submit"
                variant="outline"
                size="sm"
                :loading="busy === 'preview'"
              >
                {{ t(`${base}.secrets.check`) }}
              </LoadingButton>
            </form>
          </AlertDescription>
        </Alert>

        <fieldset class="grid gap-2">
          <legend class="mb-2 text-[13.5px] font-medium">
            {{ t(`${base}.profiles`) }}
          </legend>
          <div
            v-for="profile in preview.profiles"
            :key="profile.key"
            class="grid gap-1.5 rounded-lg border p-3"
          >
            <!-- На узком экране список всегда под именем: строки одинаковые -->
            <div
              class="grid gap-1.5 sm:flex sm:items-center sm:justify-between sm:gap-2"
            >
              <Label
                :for="`transfer-target-${profile.key}`"
                class="min-w-0 truncate"
              >
                {{ profile.name }}
              </Label>
              <Select v-model="mapping[profile.key]">
                <SelectTrigger
                  :id="`transfer-target-${profile.key}`"
                  class="w-full sm:w-56"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">
                    {{ t(`${base}.target.new`) }}
                  </SelectItem>
                  <SelectItem
                    v-for="item in profiles"
                    :key="item.id"
                    :value="item.id"
                  >
                    {{ t(`${base}.target.into`, { name: item.name }) }}
                  </SelectItem>
                  <SelectItem value="skip">
                    {{ t(`${base}.target.skip`) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <!-- Сводка посчитана для предложенного профиля: при другом выборе она неверна -->
            <p class="text-[12.5px] text-muted-foreground">
              <template v-if="mapping[profile.key] === 'skip'">
                {{ t(`${base}.counts.skipped`) }}
              </template>
              <template v-else-if="changed(profile.key)">
                {{ t(`${base}.counts.later`) }}
              </template>
              <template v-else>
                {{
                  t(`${base}.counts.line`, {
                    progress:
                      profile.counts.progress.new
                      + profile.counts.progress.updated,
                    ratings: profile.counts.ratings.new,
                    watchlist: profile.counts.watchlist.new,
                    favorites: profile.counts.favorites.new,
                  })
                }}
              </template>
            </p>
          </div>
        </fieldset>

        <dl
          class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 rounded-lg border p-3 text-[13.5px]"
        >
          <template v-if="preview.collections">
            <dt>{{ t(`${base}.summary.collections`) }}</dt>
            <dd class="text-right tabular-nums">
              {{ preview.collections.new + preview.collections.merged }}
            </dd>
          </template>
          <dt>{{ t(`${base}.summary.voices`) }}</dt>
          <dd class="text-right tabular-nums">
            {{ preview.voices }}
          </dd>
          <template v-if="preview.libraries">
            <dt>{{ t(`${base}.summary.folders`) }}</dt>
            <dd class="text-right tabular-nums">
              {{ preview.libraries.folders.new }}
            </dd>
            <dt>{{ t(`${base}.summary.decisions`) }}</dt>
            <dd class="text-right tabular-nums">
              {{ preview.libraries.decisions }}
            </dd>
          </template>
          <template v-if="preview.settings">
            <dt>{{ t(`${base}.summary.settings`) }}</dt>
            <dd class="text-right tabular-nums">
              {{ settingsTotal }}
            </dd>
          </template>
          <template v-if="preview.secrets !== 'none'">
            <dt>{{ t(`${base}.summary.secrets`) }}</dt>
            <dd class="text-right">
              {{
                t(
                  preview.secrets === "ok"
                    ? `${base}.summary.secretsOk`
                    : `${base}.summary.secretsNo`,
                )
              }}
            </dd>
          </template>
        </dl>

        <Alert v-if="preview.libraries?.missingFolders.length" variant="info">
          <InfoIcon />
          <AlertTitle>{{ t(`${base}.missingFolders`) }}</AlertTitle>
          <AlertDescription class="grid gap-1">
            <span>{{ t(`${base}.missingFoldersText`) }}</span>
            <span
              v-for="path in preview.libraries.missingFolders"
              :key="path"
              class="truncate font-mono text-xs"
              :title="path"
            >{{ path }}</span>
          </AlertDescription>
        </Alert>

        <fieldset class="grid gap-2">
          <legend class="mb-2 text-[13.5px] font-medium">
            {{ t(`${base}.conflicts`) }}
          </legend>
          <RadioGroup v-model="conflicts" class="gap-2">
            <Label
              v-for="policy in policies"
              :key="policy"
              :for="`transfer-conflicts-${policy}`"
              class="flex items-start gap-2.5 font-normal"
            >
              <RadioGroupItem
                :id="`transfer-conflicts-${policy}`"
                :value="policy"
                class="mt-0.5"
              />
              <span class="grid gap-0.5">
                <span class="font-medium">
                  {{ t(`panel.imports.policies.${policy}`) }}
                </span>
                <span class="text-[12.5px] text-muted-foreground">
                  {{ t(`panel.imports.policies.${policy}Hint`) }}
                </span>
              </span>
            </Label>
          </RadioGroup>
        </fieldset>

        <p class="text-[12.5px] text-muted-foreground">
          {{ t(`${base}.backupNote`) }}
        </p>

        <Alert v-if="applyError" variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{{ applyError }}</AlertDescription>
        </Alert>
      </div>

      <!-- Шаг 3: итог -->
      <div v-else-if="step === 'result' && result" class="grid gap-4">
        <dl
          class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 rounded-lg border p-3 text-[13.5px]"
        >
          <dt>{{ t(`${base}.result.created`) }}</dt>
          <dd class="text-right tabular-nums">
            {{ result.profiles.created }}
          </dd>
          <dt>{{ t(`${base}.result.merged`) }}</dt>
          <dd class="text-right tabular-nums">
            {{ result.profiles.merged }}
          </dd>
          <dt>{{ t(`${base}.result.changed`) }}</dt>
          <dd class="text-right font-medium tabular-nums">
            {{ result.profiles.changed }}
          </dd>
          <dt>{{ t(`${base}.summary.collections`) }}</dt>
          <dd class="text-right tabular-nums">
            {{ result.collections }}
          </dd>
          <dt>{{ t(`${base}.summary.folders`) }}</dt>
          <dd class="text-right tabular-nums">
            {{ result.folders }}
          </dd>
          <dt>{{ t(`${base}.summary.settings`) }}</dt>
          <dd class="text-right tabular-nums">
            {{ result.settings }}
          </dd>
          <dt class="text-muted-foreground">
            {{ t(`${base}.result.skipped`) }}
          </dt>
          <dd class="text-right text-muted-foreground tabular-nums">
            {{ result.skipped }}
          </dd>
        </dl>
        <Alert v-if="result.backup" variant="info">
          <InfoIcon />
          <AlertDescription>
            {{
              t(`${base}.result.undoHint`)
            }}
          </AlertDescription>
        </Alert>
      </div>

      <DialogFooter>
        <template v-if="step === 'file'">
          <Button variant="outline" @click="open = false">
            {{ t("panel.common.cancel") }}
          </Button>
          <LoadingButton
            type="submit"
            form="transfer-import-file"
            :loading="busy === 'preview'"
          >
            {{ t(`${base}.next`) }}
          </LoadingButton>
        </template>
        <template v-else-if="step === 'preview'">
          <Button variant="outline" :disabled="!!busy" @click="step = 'file'">
            {{ t(`${base}.back`) }}
          </Button>
          <LoadingButton
            :loading="busy === 'apply'"
            :disabled="busy === 'preview'"
            @click="onApply"
          >
            {{ t(`${base}.submit`) }}
          </LoadingButton>
        </template>
        <template v-else>
          <Button v-if="backupItem" variant="outline" @click="onUndo">
            {{ t(`${base}.result.undo`) }}
          </Button>
          <Button @click="open = false">
            {{ t("panel.imports.dialog.done") }}
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <BackupRestoreDialog
    v-model:open="restoreOpen"
    :item="backupItem"
    @finished="
      (outcome) => {
        open = false;
        emit('restored', outcome);
      }
    "
  />
</template>
