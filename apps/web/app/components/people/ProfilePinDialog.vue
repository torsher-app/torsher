<script setup lang="ts">
import type { Profile } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
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
  PinInput,
  PinInputGroup,
  PinInputSlot,
} from '@/components/ui/pin-input'
import LoadingButton from '~/components/LoadingButton.vue'
import { dialogSheetClass } from '~/lib/dialog'

const props = defineProps<{
  profile: Profile | null
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { setPin } = useProfiles()
const shown = useLastValue(() => props.profile)

const schema = computed(() =>
  toTypedSchema(
    z.object({
      pin: z.string().regex(/^\d{4}$/, t('panel.people.validation.pin')),
    }),
  ),
)

const { handleSubmit, defineField, errors, isSubmitting, resetForm } = useForm({
  validationSchema: schema,
  initialValues: { pin: '' },
})

const [pin] = defineField('pin')

const pinDigits = computed({
  get: () => (pin.value ?? '').split(''),
  set: (digits: string[]) => {
    pin.value = digits.join('').replace(/\D/g, '').slice(0, 4)
  },
})

watch(open, (isOpen) => {
  if (isOpen)
    resetForm({ values: { pin: '' } })
})

const onSubmit = handleSubmit(async (values) => {
  if (!props.profile)
    return

  await setPin(props.profile.id, values.pin)
  toast.success(
    t('panel.people.profiles.toasts.pinSet', { name: props.profile.name }),
  )
  open.value = false
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>
          {{ t("panel.people.pinDialog.title", { name: shown?.name }) }}
        </DialogTitle>
        <DialogDescription>
          {{ t("panel.people.pinDialog.text") }}
        </DialogDescription>
      </DialogHeader>

      <form
        id="profile-pin-form"
        class="grid gap-2"
        novalidate
        @submit="onSubmit"
      >
        <Label for="profile-new-pin">{{
          t("panel.people.pinDialog.label")
        }}</Label>
        <PinInput
          v-model="pinDigits"
          mask
          aria-describedby="profile-new-pin-hint"
        >
          <PinInputGroup>
            <PinInputSlot
              v-for="index in 4"
              :id="index === 1 ? 'profile-new-pin' : undefined"
              :key="index"
              :index="index - 1"
              inputmode="numeric"
              class="size-11 font-mono text-lg"
              :aria-invalid="!!errors.pin || undefined"
            />
          </PinInputGroup>
        </PinInput>
        <p
          id="profile-new-pin-hint"
          class="text-[12.5px]"
          :class="errors.pin ? 'text-destructive' : 'text-muted-foreground'"
        >
          {{ errors.pin ?? t("panel.people.profileDialog.pinHint") }}
        </p>
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
          form="profile-pin-form"
          :loading="isSubmitting"
        >
          {{ t("panel.people.pinDialog.submit") }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
