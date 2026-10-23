<script setup lang="ts">
import type { Collection } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Switch } from '@/components/ui/switch'
import LoadingButton from '~/components/LoadingButton.vue'
import ProfileAvatar from '~/components/people/ProfileAvatar.vue'
import { dialogSheetClass } from '~/lib/dialog'

const props = defineProps<{
  /** Подборка для правки; без неё диалог создаёт новую */
  collection?: Collection | null
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { create, update } = useCollections()
const { profiles, load: loadProfiles, state: profilesState } = useProfiles()

const shown = useLastValue(() => props.collection)
const isEdit = computed(() => !!shown.value)

const schema = computed(() =>
  toTypedSchema(
    z.object({
      name: z
        .string()
        .trim()
        .min(1, t('panel.collections.validation.name'))
        .max(60, t('panel.collections.validation.nameLength')),
      showOnHome: z.boolean(),
      // Профили, которые видят подборку; остальным она скрыта
      visibleTo: z.array(z.string()),
    }),
  ),
)

const {
  handleSubmit,
  defineField,
  errors,
  isSubmitting,
  resetForm,
  setFieldError,
} = useForm({
  validationSchema: schema,
  initialValues: { name: '', showOnHome: true, visibleTo: [] as string[] },
})

const [name, nameProps] = defineField('name')
const [showOnHome] = defineField('showOnHome')
const [visibleTo] = defineField('visibleTo')

function isVisible(id: string) {
  return (visibleTo.value ?? []).includes(id)
}

function setVisible(id: string, checked: boolean | 'indeterminate') {
  const rest = (visibleTo.value ?? []).filter(item => item !== id)

  visibleTo.value = checked === true ? [...rest, id] : rest
}

watch(open, (isOpen) => {
  if (!isOpen)
    return

  if (profilesState.value === 'idle')
    void loadProfiles()

  const current = props.collection
  const hidden = new Set(current?.hiddenFrom ?? [])

  resetForm({
    values: {
      name: current?.name ?? '',
      showOnHome: current?.showOnHome ?? true,
      visibleTo: profiles.value
        .map(item => item.id)
        .filter(id => !hidden.has(id)),
    },
  })
})

// Профили пришли после открытия диалога: видят все, кроме скрытых у подборки
watch(profiles, (items) => {
  if (!open.value)
    return

  const hidden = new Set(props.collection?.hiddenFrom ?? [])

  visibleTo.value = items
    .map(item => item.id)
    .filter(id => !hidden.has(id))
})

const onSubmit = handleSubmit(async (form) => {
  const body = {
    name: form.name,
    showOnHome: form.showOnHome,
    hiddenFrom: profiles.value
      .map(item => item.id)
      .filter(id => !form.visibleTo.includes(id)),
  }

  try {
    if (props.collection) {
      const saved = await update(props.collection.id, body)

      toast.success(t('panel.collections.toasts.saved', { name: saved.name }))
    }
    else {
      const created = await create(body)

      toast.success(
        t('panel.collections.toasts.created', { name: created.name }),
      )
    }

    open.value = false
  }
  catch (err) {
    if (isDuplicateName(err)) {
      setFieldError('name', t('panel.collections.validation.duplicate'))

      return
    }

    toast.error(t('panel.collections.toasts.saveFailed'))
  }
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>
          {{
            isEdit
              ? t("panel.collections.dialog.editTitle", { name: shown?.name })
              : t("panel.collections.dialog.createTitle")
          }}
        </DialogTitle>
        <DialogDescription>
          {{ t("panel.collections.dialog.text") }}
        </DialogDescription>
      </DialogHeader>

      <form
        id="collection-form"
        class="grid gap-4"
        novalidate
        @submit="onSubmit"
      >
        <div class="grid gap-2">
          <Label for="collection-name">{{
            t("panel.collections.dialog.name")
          }}</Label>
          <Input
            id="collection-name"
            v-model="name"
            v-bind="nameProps"
            autocomplete="off"
            :placeholder="t('panel.collections.dialog.namePlaceholder')"
            :aria-invalid="!!errors.name || undefined"
          />
          <p v-if="errors.name" class="text-[12.5px] text-destructive">
            {{ errors.name }}
          </p>
        </div>

        <div class="flex items-start justify-between gap-4">
          <div class="grid gap-1">
            <Label for="collection-home">{{
              t("panel.collections.dialog.showOnHome")
            }}</Label>
            <p class="text-[12.5px] text-muted-foreground">
              {{ t("panel.collections.dialog.showOnHomeHint") }}
            </p>
          </div>
          <Switch id="collection-home" v-model="showOnHome" />
        </div>

        <fieldset class="grid gap-2">
          <legend class="mb-2 text-sm font-medium">
            {{ t("panel.collections.dialog.visibleTo") }}
          </legend>
          <label
            v-for="profile in profiles"
            :key="profile.id"
            class="flex cursor-pointer items-center gap-2.5 text-[13.5px]"
          >
            <Checkbox
              :model-value="isVisible(profile.id)"
              @update:model-value="(checked) => setVisible(profile.id, checked)"
            />
            <ProfileAvatar :name="profile.name" :color="profile.color" />
            <span class="min-w-0 truncate">{{ profile.name }}</span>
          </label>
          <p class="text-[12.5px] text-muted-foreground">
            {{ t("panel.collections.dialog.visibleToHint") }}
          </p>
        </fieldset>
      </form>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="isSubmitting"
          @click="open = false"
        >
          {{ t("panel.common.cancel") }}
        </Button>
        <LoadingButton
          type="submit"
          form="collection-form"
          :loading="isSubmitting"
        >
          {{
            isEdit
              ? t("panel.common.save")
              : t("panel.collections.dialog.submit")
          }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
