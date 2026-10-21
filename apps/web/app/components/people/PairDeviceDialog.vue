<script setup lang="ts">
import type { PairingErrorKind } from '~/composables/useDevices'
import { CircleAlertIcon } from '@lucide/vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
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
import {
  PinInput,
  PinInputGroup,
  PinInputSeparator,
  PinInputSlot,
} from '@/components/ui/pin-input'
import LoadingButton from '~/components/LoadingButton.vue'
import { pairingErrorKind } from '~/composables/useDevices'
import { dialogSheetClass } from '~/lib/dialog'
import { normalizePairingCode } from '~/lib/profiles'

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { confirmPairing } = useDevices()

const serverError = ref<PairingErrorKind | null>(null)

const schema = computed(() =>
  toTypedSchema(
    z.object({
      code: z.string().length(6, t('panel.people.validation.code')),
      name: z
        .string()
        .trim()
        .min(1, t('panel.people.validation.deviceName'))
        .max(60),
    }),
  ),
)

const { handleSubmit, defineField, errors, isSubmitting, resetForm } = useForm({
  validationSchema: schema,
  initialValues: { code: '', name: '' },
})

const [code] = defineField('code')
const [name, nameProps] = defineField('name')

// Вставка из буфера раскладывает символы по ячейкам; дефис, пробелы
// и строчные буквы приводятся к виду кода на экране ТВ
const codeChars = computed({
  get: () => (code.value ?? '').split(''),
  set: (chars: string[]) => {
    code.value = normalizePairingCode(chars.join(''))
    serverError.value = null
  },
})

// PinInput обрезает вставку до шести символов раньше, чем из неё уходят
// дефис и пробелы («K7Q-4XP» потерял бы последний символ): вставку
// разбираем сами, до примитива
function onPaste(event: ClipboardEvent) {
  codeChars.value = (event.clipboardData?.getData('text') ?? '').split('')
}

watch(open, (isOpen) => {
  if (isOpen) {
    resetForm({
      values: { code: '', name: t('panel.people.pair.nameDefault') },
    })
    serverError.value = null
  }
})

const onSubmit = handleSubmit(async (values) => {
  serverError.value = null

  try {
    const confirmed = await confirmPairing(values.code, values.name)

    open.value = false
    toast.success(t('panel.people.pair.done'), {
      description: t('panel.people.pair.doneText', { name: confirmed.name }),
    })
  }
  catch (err) {
    serverError.value = await pairingErrorKind(err)
  }
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>{{ t("panel.people.pair.title") }}</DialogTitle>
        <DialogDescription>{{ t("panel.people.pair.text") }}</DialogDescription>
      </DialogHeader>

      <form id="pair-device" class="grid gap-5" novalidate @submit="onSubmit">
        <Alert v-if="serverError" variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>
            {{ t(`panel.people.pair.errorTitles.${serverError}`) }}
          </AlertTitle>
          <AlertDescription>
            {{ t(`panel.people.pair.errors.${serverError}`) }}
          </AlertDescription>
        </Alert>

        <div class="grid justify-items-center gap-2">
          <Label for="pair-code">{{ t("panel.people.pair.code") }}</Label>
          <PinInput
            v-model="codeChars"
            aria-describedby="pair-code-hint"
            @paste.capture.prevent.stop="onPaste"
          >
            <PinInputGroup>
              <PinInputSlot
                v-for="index in 3"
                :id="index === 1 ? 'pair-code' : undefined"
                :key="index"
                :index="index - 1"
                autocapitalize="characters"
                autocomplete="off"
                class="h-12 w-10 font-mono text-xl font-medium uppercase sm:w-11"
                :aria-invalid="!!errors.code || !!serverError || undefined"
              />
            </PinInputGroup>
            <PinInputSeparator class="text-muted-foreground" />
            <PinInputGroup>
              <PinInputSlot
                v-for="index in 3"
                :key="index"
                :index="index + 2"
                autocapitalize="characters"
                autocomplete="off"
                class="h-12 w-10 font-mono text-xl font-medium uppercase sm:w-11"
                :aria-invalid="!!errors.code || !!serverError || undefined"
              />
            </PinInputGroup>
          </PinInput>
          <p
            id="pair-code-hint"
            class="text-[12.5px]"
            :class="errors.code ? 'text-destructive' : 'text-muted-foreground'"
          >
            {{ errors.code ?? t("panel.people.pair.codeHint") }}
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="pair-name">{{ t("panel.people.pair.name") }}</Label>
          <Input
            id="pair-name"
            v-model="name"
            v-bind="nameProps"
            autocomplete="off"
            :aria-invalid="!!errors.name || undefined"
            aria-describedby="pair-name-hint"
          />
          <p
            id="pair-name-hint"
            class="text-[12.5px]"
            :class="errors.name ? 'text-destructive' : 'text-muted-foreground'"
          >
            {{ errors.name ?? t("panel.people.pair.nameHint") }}
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
        <LoadingButton type="submit" form="pair-device" :loading="isSubmitting">
          {{ t("panel.people.pair.submit") }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
