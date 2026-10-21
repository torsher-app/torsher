<script setup lang="ts">
import type { Profile } from '@torsher/api-client'
import { CheckIcon } from '@lucide/vue'
import { language } from '@torsher/i18n'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  PinInput,
  PinInputGroup,
  PinInputSlot,
} from '@/components/ui/pin-input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import LoadingButton from '~/components/LoadingButton.vue'
import { dialogSheetClass } from '~/lib/dialog'
import {
  initialOf,
  PROFILE_AGE_LIMITS,
  PROFILE_COLORS,
  profileColorClass,
} from '~/lib/profiles'

const props = defineProps<{
  /** Профиль для правки; без него диалог создаёт новый */
  profile?: Profile | null
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { create, update, profiles } = useProfiles()

const shown = useLastValue(() => props.profile)
const isEdit = computed(() => !!shown.value)
// Select не принимает пустое значение: «язык устройства» и «без ограничений» — свои ключи
const DEVICE_LANGUAGE = 'device'
const NO_LIMIT = 'none'
const languageOptions = Object.keys(language) as (keyof typeof language)[]

const schema = computed(() =>
  toTypedSchema(
    z.object({
      name: z.string().trim().min(1, t('panel.people.validation.name')).max(40),
      color: z.enum(PROFILE_COLORS),
      language: z.string(),
      ageLimit: z.string(),
      // PIN задаётся при создании; при правке — отдельным действием
      pin: z
        .string()
        .refine(
          value => value === '' || /^\d{4}$/.test(value),
          t('panel.people.validation.pin'),
        ),
    }),
  ),
)

const { handleSubmit, defineField, errors, isSubmitting, resetForm, values }
  = useForm({
    validationSchema: schema,
    initialValues: {
      name: '',
      color: 'violet',
      language: DEVICE_LANGUAGE,
      ageLimit: NO_LIMIT,
      pin: '',
    },
  })

const [name, nameProps] = defineField('name')
const [color] = defineField('color')
const [lang] = defineField('language')
const [ageLimit] = defineField('ageLimit')
const [pin] = defineField('pin')

// PinInput хранит символы массивом, форма — строкой
const pinDigits = computed({
  get: () => (pin.value ?? '').split(''),
  set: (digits: string[]) => {
    pin.value = digits.join('').replace(/\D/g, '').slice(0, 4)
  },
})

/** Новому профилю — первый цвет, которого ещё нет у других */
function freeColor() {
  const used = new Set(profiles.value.map(item => item.color))

  return PROFILE_COLORS.find(item => !used.has(item)) ?? PROFILE_COLORS[0]!
}

watch(open, (isOpen) => {
  if (!isOpen)
    return

  const current = props.profile

  resetForm({
    values: {
      name: current?.name ?? '',
      color: current?.color ?? freeColor(),
      language: current?.language ?? DEVICE_LANGUAGE,
      ageLimit: current?.ageLimit ? String(current.ageLimit) : NO_LIMIT,
      pin: '',
    },
  })
})

const onSubmit = handleSubmit(async (form) => {
  const body = {
    name: form.name,
    color: form.color,
    language:
      form.language === DEVICE_LANGUAGE
        ? null
        : (form.language as keyof typeof language),
    ageLimit:
      form.ageLimit === NO_LIMIT
        ? null
        : (Number(form.ageLimit) as (typeof PROFILE_AGE_LIMITS)[number]),
  }

  if (props.profile) {
    const saved = await update(props.profile.id, body)

    toast.success(
      t('panel.people.profiles.toasts.saved', { name: saved.name }),
    )
  }
  else {
    const created = await create({ ...body, pin: form.pin || undefined })

    toast.success(
      t('panel.people.profiles.toasts.created', { name: created.name }),
    )
  }

  open.value = false
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>
          {{
            isEdit
              ? t("panel.people.profileDialog.editTitle", {
                name: shown?.name,
              })
              : t("panel.people.profileDialog.createTitle")
          }}
        </DialogTitle>
        <DialogDescription>
          {{
            isEdit
              ? t("panel.people.profileDialog.editText")
              : t("panel.people.profileDialog.createText")
          }}
        </DialogDescription>
      </DialogHeader>

      <form id="profile-form" class="grid gap-4" novalidate @submit="onSubmit">
        <div class="grid gap-2">
          <Label for="profile-name">{{
            t("panel.people.profileDialog.name")
          }}</Label>
          <div class="flex items-center gap-2.5">
            <span
              :class="
                cn(
                  'grid size-9 shrink-0 place-items-center rounded-lg font-semibold text-white',
                  profileColorClass[values.color ?? 'violet'],
                )
              "
              aria-hidden="true"
            >
              {{ initialOf(values.name ?? "") }}
            </span>
            <Input
              id="profile-name"
              v-model="name"
              v-bind="nameProps"
              autocomplete="off"
              :placeholder="t('panel.people.profileDialog.namePlaceholder')"
              :aria-invalid="!!errors.name || undefined"
            />
          </div>
          <p v-if="errors.name" class="text-[12.5px] text-destructive">
            {{ errors.name }}
          </p>
        </div>

        <div class="grid gap-2">
          <span id="profile-color-label" class="text-sm font-medium">{{
            t("panel.people.profileDialog.color")
          }}</span>
          <RadioGroup
            v-model="color"
            class="flex flex-wrap gap-2"
            aria-labelledby="profile-color-label"
          >
            <Label
              v-for="item in PROFILE_COLORS"
              :key="item"
              :for="`profile-color-${item}`"
              :title="t(`panel.people.colors.${item}`)"
              :class="
                cn(
                  'relative grid size-8 cursor-pointer place-items-center rounded-full text-white ring-offset-2 ring-offset-background has-focus-visible:ring-2 has-focus-visible:ring-ring has-[[data-state=checked]]:ring-2 has-[[data-state=checked]]:ring-foreground',
                  profileColorClass[item],
                )
              "
            >
              <RadioGroupItem
                :id="`profile-color-${item}`"
                :value="item"
                class="sr-only"
                :aria-label="t(`panel.people.colors.${item}`)"
              />
              <!-- Скрытый радио-элемент тоже лежит в метке: галочка центрируется сама по себе -->
              <CheckIcon
                v-if="color === item"
                class="absolute inset-0 m-auto size-4 stroke-3"
                aria-hidden="true"
              />
            </Label>
          </RadioGroup>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="grid content-start gap-2">
            <Label for="profile-language">{{
              t("panel.people.profileDialog.language")
            }}</Label>
            <Select v-model="lang">
              <SelectTrigger id="profile-language" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem :value="DEVICE_LANGUAGE">
                  {{ t("panel.people.profiles.deviceLanguage") }}
                </SelectItem>
                <SelectItem
                  v-for="item in languageOptions"
                  :key="item"
                  :value="item"
                >
                  {{ language[item] }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-[12.5px] text-muted-foreground">
              {{ t("panel.people.profileDialog.languageHint") }}
            </p>
          </div>

          <div class="grid content-start gap-2">
            <Label for="profile-age">{{
              t("panel.people.profileDialog.ageLimit")
            }}</Label>
            <Select v-model="ageLimit">
              <SelectTrigger id="profile-age" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem :value="NO_LIMIT">
                  {{ t("panel.people.profileDialog.noLimits") }}
                </SelectItem>
                <SelectItem
                  v-for="age in PROFILE_AGE_LIMITS"
                  :key="age"
                  :value="String(age)"
                >
                  {{ t("panel.people.profiles.age", { age }) }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div v-if="!isEdit" class="grid gap-2">
          <div class="flex items-baseline justify-between gap-3">
            <Label for="profile-pin">{{
              t("panel.people.profileDialog.pin")
            }}</Label>
            <span class="text-[12.5px] text-muted-foreground">{{
              t("panel.common.optional")
            }}</span>
          </div>
          <PinInput v-model="pinDigits" aria-describedby="profile-pin-hint">
            <PinInputGroup>
              <PinInputSlot
                v-for="index in 4"
                :id="index === 1 ? 'profile-pin' : undefined"
                :key="index"
                :index="index - 1"
                inputmode="numeric"
                class="size-10 font-mono text-base"
                :aria-invalid="!!errors.pin || undefined"
              />
            </PinInputGroup>
          </PinInput>
          <p
            v-if="errors.pin"
            id="profile-pin-hint"
            class="text-[12.5px] text-destructive"
          >
            {{ errors.pin }}
          </p>
          <p
            v-else
            id="profile-pin-hint"
            class="text-[12.5px] text-muted-foreground"
          >
            {{ t("panel.people.profileDialog.pinHint") }}
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
        <LoadingButton
          type="submit"
          form="profile-form"
          :loading="isSubmitting"
        >
          {{
            isEdit
              ? t("panel.common.save")
              : t("panel.people.profileDialog.submit")
          }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
