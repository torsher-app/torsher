<script setup lang="ts">
import type { UnmatchedImportRow } from '@torsher/api-client'
import { CircleAlertIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import LoadingButton from '~/components/LoadingButton.vue'
import TitleSearch from '~/components/TitleSearch.vue'
import { dialogSheetClass } from '~/lib/dialog'

/** Поиск тайтла для строки импорта: открывается с названием и годом из файла */
const props = defineProps<{
  row: UnmatchedImportRow | null
  save: (titleId: string) => Promise<void>
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const shown = useLastValue(() => props.row)

const query = ref('')
const chosen = ref('')
const saving = ref(false)
const failed = ref(false)

watch(open, (isOpen) => {
  if (!isOpen || !props.row)
    return

  failed.value = false
  saving.value = false
  chosen.value = props.row.suggestion?.id ?? ''
  query.value = [props.row.title, props.row.year].filter(Boolean).join(' ')
})

async function onSave() {
  saving.value = true
  failed.value = false

  try {
    await props.save(chosen.value)
    open.value = false
  }
  catch {
    failed.value = true
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
        <DialogTitle>{{ t("panel.imports.unmatched.findTitle") }}</DialogTitle>
        <DialogDescription class="truncate">
          {{ [shown?.title, shown?.year].filter(Boolean).join(" · ") }}
        </DialogDescription>
      </DialogHeader>

      <TitleSearch
        v-model:query="query"
        v-model:chosen="chosen"
        input-id="import-row-query"
        :label="t('panel.torrents.match.search')"
      />

      <Alert v-if="failed" variant="destructive">
        <CircleAlertIcon />
        <AlertDescription>
          {{
            t("panel.imports.unmatched.saveFailed")
          }}
        </AlertDescription>
      </Alert>

      <DialogFooter>
        <Button variant="outline" :disabled="saving" @click="open = false">
          {{ t("panel.common.cancel") }}
        </Button>
        <LoadingButton :loading="saving" :disabled="!chosen" @click="onSave">
          {{ t("panel.common.save") }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
