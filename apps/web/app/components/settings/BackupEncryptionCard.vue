<script setup lang="ts">
import type { BackupStatus } from '@torsher/api-client'
import { LockIcon, TriangleAlertIcon } from '@lucide/vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import * as z from 'zod'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import LoadingButton from '~/components/LoadingButton.vue'
import SecretInput from '~/components/SecretInput.vue'
import { dialogSheetClass } from '~/lib/dialog'
import { formatDate } from '~/lib/format'
import SettingsCard from './SettingsCard.vue'

const props = defineProps<{
  status: BackupStatus
}>()

const { t, locale } = useI18n()
const { setPassword, removePassword } = useBackups()

const base = 'panel.backups.encryption'

type Mode = BackupStatus['settings']['mode']

const saved = computed(() => props.status.settings.mode)
const selected = ref<Mode>(saved.value)
const changing = ref(false)
const confirmOpen = ref(false)
const removing = ref(false)

// Длина — как в DTO сервера: от 8 символов, как у пароля аккаунта, и до 1024
const schema = toTypedSchema(
  z
    .object({
      password: z
        .string()
        .min(8, t(`${base}.validation.password`))
        .max(1024, t(`${base}.validation.max`)),
      repeat: z.string(),
    })
    .refine(values => values.password === values.repeat, {
      message: t(`${base}.validation.mismatch`),
      path: ['repeat'],
    }),
)

const { handleSubmit, defineField, errors, isSubmitting, resetForm } = useForm({
  validationSchema: schema,
  initialValues: { password: '', repeat: '' },
})

// После сохранения форма пустая, а фокус в поле: проверка по blur показала
// бы ошибку при первом клике мимо
const [password, passwordProps] = defineField('password', {
  validateOnBlur: false,
})
const [repeat, repeatProps] = defineField('repeat', { validateOnBlur: false })

watch(saved, (mode) => {
  selected.value = mode
  changing.value = false
  resetForm()
})

watch(selected, () => {
  changing.value = false
  resetForm()
})

const showForm = computed(
  () =>
    selected.value === 'password' && (saved.value === 'key' || changing.value),
)

const hint = computed(() =>
  saved.value === 'password' && props.status.settings.passwordSetAt
    ? t(`${base}.setAt`, {
        date: formatDate(props.status.settings.passwordSetAt, locale.value),
      })
    : t(`${base}.keyMode`),
)

const options = computed(() => [
  {
    value: 'key' as const,
    title: t(`${base}.key`),
    text: t(`${base}.keyText`),
  },
  {
    value: 'password' as const,
    title: t(`${base}.password`),
    text: t(`${base}.passwordText`),
  },
])

const onSubmit = handleSubmit(async (values) => {
  await setPassword(values.password)
  changing.value = false
  resetForm()
  toast.success(t(`${base}.saved`), { description: t(`${base}.savedText`) })
})

async function onRemove() {
  removing.value = true

  try {
    await removePassword()
    confirmOpen.value = false
    toast.success(t(`${base}.removed`), {
      description: t(`${base}.removedText`),
    })
  }
  finally {
    removing.value = false
  }
}
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard :title="t(`${base}.title`)" :description="t(`${base}.text`)">
      <div class="grid gap-4">
        <RadioGroup
          v-model="selected"
          class="gap-2 sm:grid-cols-2"
          :aria-label="t(`${base}.mode`)"
        >
          <Label
            v-for="option in options"
            :key="option.value"
            :for="`backup-mode-${option.value}`"
            class="flex items-start gap-3 rounded-lg border border-input p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary"
          >
            <RadioGroupItem
              :id="`backup-mode-${option.value}`"
              :value="option.value"
              class="mt-0.5"
            />
            <span class="grid gap-0.5">
              <span class="font-medium">{{ option.title }}</span>
              <span class="text-[12.5px] text-muted-foreground">
                {{ option.text }}
              </span>
            </span>
          </Label>
        </RadioGroup>

        <Alert v-if="selected === 'key'" variant="warning">
          <TriangleAlertIcon />
          <AlertDescription>{{ t(`${base}.keyWarning`) }}</AlertDescription>
        </Alert>

        <template v-if="showForm">
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="grid content-start gap-2">
              <Label for="backup-password">{{
                t(`${base}.newPassword`)
              }}</Label>
              <SecretInput
                id="backup-password"
                v-model="password"
                v-bind="passwordProps"
                autocomplete="new-password"
                aria-describedby="backup-password-hint"
                :aria-invalid="!!errors.password || undefined"
                :show-label="t('panel.auth.showPassword')"
                :hide-label="t('panel.auth.hidePassword')"
              />
              <p
                v-if="errors.password"
                id="backup-password-hint"
                class="text-[12.5px] text-destructive"
              >
                {{ errors.password }}
              </p>
              <p
                v-else
                id="backup-password-hint"
                class="text-[12.5px] text-muted-foreground"
              >
                {{ t(`${base}.passwordHint`) }}
              </p>
            </div>
            <div class="grid content-start gap-2">
              <Label for="backup-password-repeat">
                {{ t(`${base}.repeatPassword`) }}
              </Label>
              <SecretInput
                id="backup-password-repeat"
                v-model="repeat"
                v-bind="repeatProps"
                autocomplete="new-password"
                :aria-invalid="!!errors.repeat || undefined"
                :show-label="t('panel.auth.showPassword')"
                :hide-label="t('panel.auth.hidePassword')"
              />
              <p v-if="errors.repeat" class="text-[12.5px] text-destructive">
                {{ errors.repeat }}
              </p>
            </div>
          </div>
          <p class="text-[12.5px] text-muted-foreground">
            {{ t(`${base}.lost`) }}
            <template v-if="saved === 'password'">
              {{ t(`${base}.oldCopies`) }}
            </template>
          </p>
        </template>
      </div>

      <template #hint>
        <span class="inline-flex items-center gap-1.5">
          <LockIcon
            v-if="saved === 'password'"
            class="size-3.5 shrink-0"
            aria-hidden="true"
          />
          {{ hint }}
        </span>
      </template>
      <template #action>
        <div class="flex flex-wrap gap-2">
          <Button
            v-if="saved === 'password' && !showForm"
            type="button"
            size="sm"
            :variant="selected === 'key' ? 'destructive' : 'ghost'"
            @click="confirmOpen = true"
          >
            {{ t(`${base}.remove`) }}
          </Button>
          <Button
            v-if="saved === 'password' && selected === 'password' && !changing"
            type="button"
            size="sm"
            variant="outline"
            @click="changing = true"
          >
            {{ t(`${base}.change`) }}
          </Button>
          <Button
            v-if="showForm && changing"
            type="button"
            size="sm"
            variant="ghost"
            :disabled="isSubmitting"
            @click="changing = false"
          >
            {{ t("panel.common.cancel") }}
          </Button>
          <LoadingButton
            v-if="showForm"
            type="submit"
            size="sm"
            :loading="isSubmitting"
          >
            {{ t(`${base}.save`) }}
          </LoadingButton>
        </div>
      </template>
    </SettingsCard>

    <AlertDialog v-model:open="confirmOpen">
      <AlertDialogContent :class="dialogSheetClass">
        <AlertDialogHeader class="place-items-start text-left">
          <AlertDialogTitle>
            {{ t(`${base}.removeDialog.title`) }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{ t(`${base}.removeDialog.text`) }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="removing">
            {{ t("panel.common.cancel") }}
          </AlertDialogCancel>
          <LoadingButton
            variant="destructive"
            :loading="removing"
            @click="onRemove"
          >
            {{ t(`${base}.removeDialog.confirm`) }}
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </form>
</template>
