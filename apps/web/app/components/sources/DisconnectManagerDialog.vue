<script setup lang="ts">
import type { IndexerManager } from '@torsher/api-client'
import type { IndexersMode } from '~/composables/useSources'
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
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import LoadingButton from '~/components/LoadingButton.vue'
import { dialogSheetClass } from '~/lib/dialog'

const props = defineProps<{
  manager: IndexerManager
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { deleteManager } = useSources()

const mode = ref<IndexersMode>('keep')
const isDisconnecting = ref(false)

const name = computed(() => t(`panel.kinds.${props.manager.kind}`))
const options = computed(() => [
  {
    value: 'keep' as const,
    title: t('panel.sources.managers.keepIndexers', props.manager.indexerCount),
    text: t('panel.sources.managers.keepText'),
  },
  {
    value: 'delete' as const,
    title: t('panel.sources.managers.deleteIndexers'),
    text: t('panel.sources.managers.deleteText'),
  },
])

watch(open, (isOpen) => {
  if (isOpen)
    mode.value = 'keep'
})

// Исход выбирается радио, кнопка одна: AlertDialogAction закрыл бы диалог до конца запроса
async function onDisconnect() {
  isDisconnecting.value = true

  try {
    await deleteManager(props.manager.id, mode.value)
    open.value = false
    toast.success(
      t('panel.sources.managers.disconnected', { manager: name.value }),
    )
  }
  finally {
    isDisconnecting.value = false
  }
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent :class="dialogSheetClass">
      <AlertDialogHeader class="place-items-start text-left">
        <AlertDialogTitle>
          {{ t("panel.sources.managers.disconnectTitle", { manager: name }) }}
        </AlertDialogTitle>
        <AlertDialogDescription class="break-words">
          {{ t("panel.sources.managers.disconnectText") }}
          <span class="font-mono text-xs">{{ manager.url }}</span>
        </AlertDialogDescription>
      </AlertDialogHeader>

      <RadioGroup
        v-model="mode"
        class="gap-2"
        :aria-label="t('panel.sources.managers.outcome')"
      >
        <Label
          v-for="option in options"
          :key="option.value"
          :for="`disconnect-${option.value}`"
          class="flex cursor-pointer items-start gap-3 rounded-lg border border-input p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary"
        >
          <RadioGroupItem
            :id="`disconnect-${option.value}`"
            :value="option.value"
            class="mt-0.5"
          />
          <span class="grid gap-0.5">
            <span class="font-medium">{{ option.title }}</span>
            <span class="text-[12.5px] text-muted-foreground">{{
              option.text
            }}</span>
          </span>
        </Label>
      </RadioGroup>

      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isDisconnecting">
          {{ t("panel.common.cancel") }}
        </AlertDialogCancel>
        <LoadingButton
          variant="destructive"
          :loading="isDisconnecting"
          @click="onDisconnect"
        >
          {{ t("panel.sources.managers.disconnect") }}
        </LoadingButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
