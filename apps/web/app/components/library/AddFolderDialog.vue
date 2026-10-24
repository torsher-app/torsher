<script setup lang="ts">
import type { Library } from '@torsher/api-client'
import type { FolderPathError } from '~/composables/useLibraries'
import { CircleAlertIcon } from '@lucide/vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { z } from 'zod'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import LoadingButton from '~/components/LoadingButton.vue'
import { folderPathError } from '~/composables/useLibraries'
import { dialogSheetClass } from '~/lib/dialog'
import FolderPicker from '~/components/storage/FolderPicker.vue'

const props = defineProps<{
  library: Library | null
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { addFolder } = useLibraries()
const serverError = ref<FolderPathError | null>(null)

const schema = computed(() =>
  toTypedSchema(
    z.object({
      path: z.string().trim().min(1, t('panel.library.validation.path')),
      hint: z.enum(['auto', 'movies', 'shows']),
    }),
  ),
)

const { handleSubmit, defineField, errors, isSubmitting, resetForm } = useForm({
  validationSchema: schema,
  initialValues: { path: '', hint: 'auto' as 'auto' | 'movies' | 'shows' },
})

const [path] = defineField('path')
const [hint] = defineField('hint')

watch(open, (isOpen) => {
  if (isOpen) {
    resetForm()
    serverError.value = null
  }
})

const onSubmit = handleSubmit(async (values) => {
  if (!props.library)
    return

  serverError.value = null

  try {
    await addFolder(props.library.id, {
      path: values.path,
      hint: props.library.kind === 'video' ? values.hint : undefined,
    })
    open.value = false
    toast.success(t('panel.library.toasts.folderAdded'), {
      description: values.path,
    })
  }
  catch (err) {
    serverError.value = await folderPathError(err)
  }
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>{{ t("panel.library.addFolder.title") }}</DialogTitle>
        <DialogDescription>{{ library?.name }}</DialogDescription>
      </DialogHeader>

      <form
        id="add-folder"
        class="grid min-w-0 gap-4"
        novalidate
        @submit="onSubmit"
      >
        <Alert v-if="serverError" variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{{ t("panel.library.pathErrors.title") }}</AlertTitle>
          <AlertDescription>
            {{ t(`panel.library.pathErrors.${serverError}`) }}
          </AlertDescription>
        </Alert>

        <div class="grid min-w-0 gap-2">
          <Label for="folder-path">{{ t("panel.library.add.path") }}</Label>
          <FolderPicker
            id="folder-path"
            v-model="path"
            :invalid="!!errors.path || !!serverError"
            describedby="folder-path-hint"
          />
          <p
            v-if="errors.path"
            id="folder-path-hint"
            class="text-[12.5px] text-destructive"
          >
            {{ errors.path }}
          </p>
          <p
            v-else
            id="folder-path-hint"
            class="text-[12.5px] text-muted-foreground"
          >
            {{ t("panel.library.add.pathHint") }}
          </p>
        </div>

        <div v-if="library?.kind === 'video'" class="grid gap-2">
          <Label for="folder-hint">{{ t("panel.library.add.hint") }}</Label>
          <Select v-model="hint">
            <SelectTrigger id="folder-hint" class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="item in ['auto', 'movies', 'shows']"
                :key="item"
                :value="item"
              >
                {{ t(`panel.library.hints.${item}`) }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </form>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="isSubmitting"
          @click="open = false"
        >
          {{ t("panel.common.cancel") }}
        </Button>
        <LoadingButton type="submit" form="add-folder" :loading="isSubmitting">
          {{ t("panel.library.addFolder.submit") }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
