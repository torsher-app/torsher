<script setup lang="ts">
import type { Profile } from '@torsher/api-client'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import LoadingButton from '~/components/LoadingButton.vue'
import { dialogSheetClass } from '~/lib/dialog'
import ProfileAvatar from './ProfileAvatar.vue'

const props = defineProps<{
  profile: Profile | null
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { profiles, remove } = useProfiles()
const shown = useLastValue(() => props.profile)

const mode = ref<'move' | 'drop'>('move')
const targetId = ref('')
const isDeleting = ref(false)

const targets = computed(() =>
  profiles.value.filter(item => item.id !== props.profile?.id),
)
const target = computed(() =>
  targets.value.find(item => item.id === targetId.value),
)

watch(open, (isOpen) => {
  if (!isOpen)
    return

  mode.value = 'move'
  targetId.value = targets.value[0]?.id ?? ''
})

async function onDelete() {
  if (!props.profile)
    return

  const { id, name } = props.profile

  isDeleting.value = true

  try {
    await remove(id, mode.value === 'move' ? targetId.value : undefined)
    toast.success(t('panel.people.profiles.toasts.deleted', { name }))
    open.value = false
  }
  finally {
    isDeleting.value = false
  }
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent :class="dialogSheetClass">
      <AlertDialogHeader class="place-items-start text-left">
        <AlertDialogTitle>
          {{ t("panel.people.deleteDialog.title", { name: shown?.name }) }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("panel.people.deleteDialog.text") }}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <RadioGroup v-model="mode" class="gap-2">
        <Label
          for="delete-profile-move"
          class="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5 rounded-lg border border-input p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary"
        >
          <RadioGroupItem
            id="delete-profile-move"
            value="move"
            class="mt-0.5"
          />
          <span class="grid gap-0.5">
            <span class="font-medium">{{
              t("panel.people.deleteDialog.move")
            }}</span>
            <span class="text-[12.5px] text-muted-foreground">{{
              t("panel.people.deleteDialog.moveText")
            }}</span>
          </span>
          <Select v-if="mode === 'move'" v-model="targetId">
            <SelectTrigger
              class="col-start-2 w-full"
              :aria-label="t('panel.people.deleteDialog.target')"
            >
              <!-- SelectValue сам показывает только текст пункта: аватар рисуем здесь -->
              <SelectValue>
                <span v-if="target" class="flex items-center gap-2">
                  <ProfileAvatar :name="target.name" :color="target.color" />
                  {{ target.name }}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="item in targets"
                :key="item.id"
                :value="item.id"
                :text-value="item.name"
              >
                <ProfileAvatar :name="item.name" :color="item.color" />
                {{ item.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </Label>
        <Label
          for="delete-profile-drop"
          class="flex cursor-pointer items-start gap-3 rounded-lg border border-input p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary"
        >
          <RadioGroupItem
            id="delete-profile-drop"
            value="drop"
            class="mt-0.5"
          />
          <span class="grid gap-0.5">
            <span class="font-medium">{{
              t("panel.people.deleteDialog.drop")
            }}</span>
            <span class="text-[12.5px] text-muted-foreground">{{
              t("panel.people.deleteDialog.dropText")
            }}</span>
          </span>
        </Label>
      </RadioGroup>

      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isDeleting">
          {{ t("panel.common.cancel") }}
        </AlertDialogCancel>
        <LoadingButton
          variant="destructive"
          :loading="isDeleting"
          @click="onDelete"
        >
          {{ t("panel.common.delete") }}
        </LoadingButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
