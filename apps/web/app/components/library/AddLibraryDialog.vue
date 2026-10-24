<script setup lang="ts">
import type { FolderPathError } from '~/composables/useLibraries'
import { CircleAlertIcon, FilmIcon, VideoIcon } from '@lucide/vue'
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
import { Input } from '@/components/ui/input'
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
import { folderPathError } from '~/composables/useLibraries'
import { dialogSheetClass } from '~/lib/dialog'
import FolderPicker from '~/components/storage/FolderPicker.vue'

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { create } = useLibraries()
const serverError = ref<FolderPathError | null>(null)

const schema = computed(() =>
  toTypedSchema(
    z.object({
      kind: z.enum(['video', 'home']),
      name: z
        .string()
        .trim()
        .min(1, t('panel.library.validation.name'))
        .max(100),
      path: z.string().trim().min(1, t('panel.library.validation.path')),
      hint: z.enum(['auto', 'movies', 'shows']),
    }),
  ),
)

const { handleSubmit, defineField, errors, isSubmitting, resetForm } = useForm({
  validationSchema: schema,
  initialValues: {
    kind: 'video' as 'video' | 'home',
    name: '',
    path: '',
    hint: 'auto' as 'auto' | 'movies' | 'shows',
  },
})

const [kind, kindProps] = defineField('kind')
const [name, nameProps] = defineField('name')
const [path] = defineField('path')
const [hint] = defineField('hint')

watch(open, (isOpen) => {
  if (isOpen) {
    resetForm()
    serverError.value = null
  }
})

const onSubmit = handleSubmit(async (values) => {
  serverError.value = null

  try {
    await create({
      kind: values.kind,
      name: values.name,
      path: values.path,
      hint: values.kind === 'video' ? values.hint : undefined,
    })
    open.value = false
    toast.success(t('panel.library.toasts.added'), {
      description: t('panel.library.toasts.addedText'),
    })
  }
  catch (err) {
    serverError.value = await folderPathError(err)
  }
})

const choiceClass
  = 'relative grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5 rounded-xl border border-input p-3.5 has-[[data-state=checked]]:border-primary'
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>{{ t("panel.library.add.title") }}</DialogTitle>
        <DialogDescription>
          {{ t("panel.library.add.description") }}
        </DialogDescription>
      </DialogHeader>

      <form
        id="add-library"
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

        <fieldset class="grid gap-2">
          <legend class="mb-2 text-sm font-medium">
            {{ t("panel.library.add.kind") }}
          </legend>
          <RadioGroup
            v-model="kind"
            v-bind="kindProps"
            class="grid gap-2.5 sm:grid-cols-2"
          >
            <Label :class="choiceClass">
              <RadioGroupItem value="video" class="mt-0.5" />
              <span class="grid gap-0.5">
                <span class="flex items-center gap-1.5 font-medium">
                  <FilmIcon class="size-3.5" aria-hidden="true" />
                  {{ t("panel.library.kinds.video") }}
                </span>
                <span class="text-[12.5px] font-normal text-muted-foreground">
                  {{ t("panel.library.kinds.videoText") }}
                </span>
              </span>
            </Label>
            <Label :class="choiceClass">
              <RadioGroupItem value="home" class="mt-0.5" />
              <span class="grid gap-0.5">
                <span class="flex items-center gap-1.5 font-medium">
                  <VideoIcon class="size-3.5" aria-hidden="true" />
                  {{ t("panel.library.kinds.home") }}
                </span>
                <span class="text-[12.5px] font-normal text-muted-foreground">
                  {{ t("panel.library.kinds.homeText") }}
                </span>
              </span>
            </Label>
          </RadioGroup>
        </fieldset>

        <div class="grid gap-2">
          <Label for="library-name">{{ t("panel.library.add.name") }}</Label>
          <Input
            id="library-name"
            v-model="name"
            v-bind="nameProps"
            autocomplete="off"
            :aria-invalid="!!errors.name || undefined"
          />
          <p v-if="errors.name" class="text-[12.5px] text-destructive">
            {{ errors.name }}
          </p>
        </div>

        <div class="grid min-w-0 gap-2">
          <Label for="library-path">{{ t("panel.library.add.path") }}</Label>
          <FolderPicker
            id="library-path"
            v-model="path"
            :invalid="!!errors.path || !!serverError"
            describedby="library-path-hint"
          />
          <p
            v-if="errors.path"
            id="library-path-hint"
            class="text-[12.5px] text-destructive"
          >
            {{ errors.path }}
          </p>
          <p
            v-else
            id="library-path-hint"
            class="text-[12.5px] text-muted-foreground"
          >
            {{ t("panel.library.add.pathHint") }}
          </p>
        </div>

        <div v-if="kind === 'video'" class="grid gap-2">
          <Label for="library-hint">{{ t("panel.library.add.hint") }}</Label>
          <Select v-model="hint">
            <SelectTrigger id="library-hint" class="w-full">
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
          <p class="text-[12.5px] text-muted-foreground">
            {{ t("panel.library.add.hintText") }}
          </p>
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
        <LoadingButton type="submit" form="add-library" :loading="isSubmitting">
          {{ t("panel.library.add.submit") }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
