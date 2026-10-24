<script setup lang="ts">
import { CircleAlertIcon } from '@lucide/vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import * as z from 'zod'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Label } from '@/components/ui/label'
import LoadingButton from '~/components/LoadingButton.vue'
import SecretInput from '~/components/SecretInput.vue'
import { downloadExport } from '~/composables/useTransfer'
import { dialogSheetClass } from '~/lib/dialog'

/**
 * Экспорт сервера: профили и просмотры входят всегда, подборки, библиотеки
 * и настройки — по выбору. Ключи и пароли — только под паролем экспорта.
 */
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()

const base = 'panel.transfer.export'
// Как у сервера: правило пароля копии
const PASSWORD_MIN = 8

const schema = computed(() =>
  toTypedSchema(
    z
      .object({
        collections: z.boolean(),
        libraries: z.boolean(),
        settings: z.boolean(),
        secrets: z.boolean(),
        password: z.string().max(1024, t(`${base}.validation.max`)),
      })
      .refine(
        values =>
          !values.settings
          || !values.secrets
          || values.password.length >= PASSWORD_MIN,
        {
          path: ['password'],
          message: t(`${base}.validation.min`, { n: PASSWORD_MIN }),
        },
      ),
  ),
)

const initialValues = {
  collections: true,
  libraries: true,
  settings: false,
  secrets: false,
  password: '',
}

const { handleSubmit, defineField, errors, isSubmitting, resetForm, values }
  = useForm({ validationSchema: schema, initialValues })

const [collections] = defineField('collections')
const [libraries] = defineField('libraries')
const [settings] = defineField('settings')
const [secrets] = defineField('secrets')
const [password, passwordProps] = defineField('password', {
  validateOnBlur: false,
})

const failed = ref(false)

watch(open, (value) => {
  if (value) {
    resetForm({ values: initialValues })
    failed.value = false
  }
})

const onSubmit = handleSubmit(async (form) => {
  failed.value = false

  try {
    await downloadExport({
      scope: 'server',
      include: {
        collections: form.collections,
        libraries: form.libraries,
        settings: form.settings,
      },
      password: form.settings && form.secrets ? form.password : undefined,
    })
    toast.success(t(`${base}.done`))
    open.value = false
  }
  catch {
    failed.value = true
  }
})

const options = computed(() => [
  { id: 'collections', model: collections },
  { id: 'libraries', model: libraries },
  { id: 'settings', model: settings },
])
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>{{ t(`${base}.title`) }}</DialogTitle>
        <DialogDescription>{{ t(`${base}.description`) }}</DialogDescription>
      </DialogHeader>

      <form
        id="transfer-export"
        class="grid gap-4"
        novalidate
        @submit="onSubmit"
      >
        <Alert v-if="failed" variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{{ t(`${base}.failed`) }}</AlertDescription>
        </Alert>

        <div class="grid gap-3">
          <Label
            v-for="option in options"
            :key="option.id"
            class="flex items-start gap-2.5 font-normal"
          >
            <Checkbox
              :model-value="option.model.value"
              class="mt-0.5"
              @update:model-value="option.model.value = $event === true"
            />
            <span class="grid gap-0.5">
              <span class="font-medium">{{ t(`${base}.${option.id}`) }}</span>
              <span class="text-[12.5px] text-muted-foreground">
                {{ t(`${base}.${option.id}Hint`) }}
              </span>
            </span>
          </Label>
        </div>

        <!-- Секреты — только вместе с настройками: без них им не к чему
             относиться. Блок виден всегда, чтобы диалог не менял высоту -->
        <div
          class="grid gap-3 rounded-lg border p-3"
          :class="{ 'opacity-60': !values.settings }"
        >
          <Label class="flex items-start gap-2.5 font-normal">
            <Checkbox
              :model-value="values.settings && secrets"
              :disabled="!values.settings"
              class="mt-0.5"
              @update:model-value="secrets = $event === true"
            />
            <span class="grid gap-0.5">
              <span class="font-medium">{{ t(`${base}.secrets`) }}</span>
              <span class="text-[12.5px] text-muted-foreground">
                {{ t(`${base}.secretsHint`) }}
              </span>
            </span>
          </Label>
          <div class="grid gap-1.5">
            <Label for="transfer-export-password">
              {{ t(`${base}.password`) }}
            </Label>
            <SecretInput
              id="transfer-export-password"
              v-model="password"
              v-bind="passwordProps"
              autocomplete="new-password"
              :disabled="!values.settings || !values.secrets"
              :show-label="t('panel.auth.showPassword')"
              :hide-label="t('panel.auth.hidePassword')"
              :aria-invalid="!!errors.password || undefined"
            />
            <!-- Ошибка встаёт на место подсказки в две строки: высота не прыгает -->
            <p
              class="min-h-[2lh] text-[12.5px]"
              :class="
                errors.password ? 'text-destructive' : 'text-muted-foreground'
              "
            >
              {{ errors.password ?? t(`${base}.passwordHint`) }}
            </p>
          </div>
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
        <LoadingButton
          type="submit"
          form="transfer-export"
          :loading="isSubmitting"
        >
          {{ t(`${base}.submit`) }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
