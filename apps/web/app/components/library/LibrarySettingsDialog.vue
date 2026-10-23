<script setup lang="ts">
import type { Library } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { z } from 'zod'
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
import { dialogSheetClass } from '~/lib/dialog'

/**
 * Настройки библиотеки: название, исключения по маске пути, наблюдатель за
 * изменениями и от каких профилей библиотека скрыта на витрине
 */
const props = defineProps<{
  library: Library | null
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { update } = useLibraries()
const { profiles, state: profilesState, load: loadProfiles } = useProfiles()

const schema = computed(() =>
  toTypedSchema(
    z.object({
      name: z
        .string()
        .trim()
        .min(1, t('panel.library.validation.name'))
        .max(100),
      exclude: z.string(),
      watch: z.boolean(),
      visible: z.array(z.string()),
    }),
  ),
)

const {
  handleSubmit,
  defineField,
  errors,
  isSubmitting,
  resetForm,
  setFieldValue,
  values,
} = useForm({ validationSchema: schema })

const [name, nameProps] = defineField('name')
const [exclude] = defineField('exclude')
const [watcher] = defineField('watch')

watch(open, (isOpen) => {
  const library = props.library

  if (!isOpen || !library)
    return

  if (profilesState.value === 'idle')
    void loadProfiles()

  resetForm({
    values: {
      name: library.name,
      exclude: library.exclude.join('\n'),
      watch: library.watch,
      visible: [],
    },
  })
})

// Видимость хранится как «скрыта от»: в форме — отметки «видят», по умолчанию все
watch([open, profiles], ([isOpen]) => {
  const library = props.library

  if (isOpen && library) {
    setFieldValue(
      'visible',
      profiles.value
        .filter(profile => !library.hiddenProfiles.includes(profile.id))
        .map(profile => profile.id),
    )
  }
})

function toggleVisible(id: string, checked: boolean) {
  const current = values.visible ?? []

  setFieldValue(
    'visible',
    checked ? [...current, id] : current.filter(item => item !== id),
  )
}

const onSubmit = handleSubmit(async (form) => {
  if (!props.library)
    return

  await update(props.library.id, {
    name: form.name,
    exclude: form.exclude
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean),
    watch: form.watch,
    hiddenProfiles: profiles.value
      .filter(profile => !form.visible.includes(profile.id))
      .map(profile => profile.id),
  })
  open.value = false
  toast.success(t('panel.library.toasts.saved'))
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>{{ t("panel.library.settings.title") }}</DialogTitle>
        <DialogDescription>{{ library?.name }}</DialogDescription>
      </DialogHeader>

      <form
        id="library-settings"
        class="grid gap-5"
        novalidate
        @submit="onSubmit"
      >
        <div class="grid gap-2">
          <Label for="settings-name">{{ t("panel.library.add.name") }}</Label>
          <Input
            id="settings-name"
            v-model="name"
            v-bind="nameProps"
            autocomplete="off"
            :aria-invalid="!!errors.name || undefined"
          />
          <p v-if="errors.name" class="text-[12.5px] text-destructive">
            {{ errors.name }}
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="settings-exclude">{{
            t("panel.library.settings.exclude")
          }}</Label>
          <textarea
            id="settings-exclude"
            v-model="exclude"
            rows="3"
            spellcheck="false"
            class="min-h-[72px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            placeholder="Trash/**&#10;**/*.sample.*"
            aria-describedby="settings-exclude-hint"
          />
          <p
            id="settings-exclude-hint"
            class="text-[12.5px] text-muted-foreground"
          >
            {{ t("panel.library.settings.excludeHint") }}
          </p>
        </div>

        <Label class="flex items-start justify-between gap-4 font-normal">
          <span class="grid gap-0.5">
            <span class="font-medium">{{
              t("panel.library.settings.watch")
            }}</span>
            <span class="text-[12.5px] text-muted-foreground">
              {{ t("panel.library.settings.watchHint") }}
            </span>
          </span>
          <Switch v-model="watcher" />
        </Label>

        <fieldset class="grid gap-2">
          <legend class="mb-1 text-sm font-medium">
            {{ t("panel.library.settings.visible") }}
          </legend>
          <p class="text-[12.5px] text-muted-foreground">
            {{ t("panel.library.settings.visibleHint") }}
          </p>
          <Label
            v-for="profile in profiles"
            :key="profile.id"
            class="flex items-center gap-2.5 font-normal"
          >
            <Checkbox
              :model-value="(values.visible ?? []).includes(profile.id)"
              @update:model-value="
                (checked) => toggleVisible(profile.id, checked === true)
              "
            />
            {{ profile.name }}
          </Label>
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
          form="library-settings"
          :loading="isSubmitting"
        >
          {{ t("panel.common.save") }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
