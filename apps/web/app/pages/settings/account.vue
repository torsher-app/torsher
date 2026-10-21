<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import LoadingButton from '~/components/LoadingButton.vue'
import EmailCard from '~/components/settings/EmailCard.vue'
import PasswordCard from '~/components/settings/PasswordCard.vue'
import SettingsCard from '~/components/settings/SettingsCard.vue'

definePageMeta({
  middleware: 'required-auth',
})

const { t } = useI18n()
const { user, updateName } = useUser()

// Правило совпадает с DTO сервера: имя от 2 символов
const schema = toTypedSchema(
  z.object({
    name: z.string().trim().min(2, t('panel.auth.validation.name')).max(100),
  }),
)

const { handleSubmit, defineField, errors, isSubmitting, meta, resetForm }
  = useForm({
    validationSchema: schema,
    initialValues: { name: user.value?.name ?? '' },
  })

const [name, nameProps] = defineField('name')

// «Сохранить» активна только после правки поля
const onSubmit = handleSubmit(async (values) => {
  await updateName(values.name)
  resetForm({ values: { name: values.name } })
  toast.success(t('panel.settings.account.saved'))
})
</script>

<template>
  <div class="grid gap-5">
    <header>
      <h1 class="text-[22px] font-semibold tracking-tight">
        {{ t("panel.settings.nav.account") }}
      </h1>
      <p class="mt-1 text-muted-foreground">
        {{ t("panel.settings.account.description") }}
      </p>
    </header>

    <form novalidate @submit="onSubmit">
      <SettingsCard
        :title="t('panel.settings.account.nameTitle')"
        :description="t('panel.settings.account.nameText')"
      >
        <div class="grid max-w-sm gap-2">
          <Label for="account-name" class="sr-only">{{
            t("panel.auth.name")
          }}</Label>
          <Input
            id="account-name"
            v-model="name"
            v-bind="nameProps"
            autocomplete="name"
            :aria-invalid="!!errors.name || undefined"
          />
          <p v-if="errors.name" class="text-[12.5px] text-destructive">
            {{ errors.name }}
          </p>
        </div>
        <template #hint>
          {{ t("panel.settings.account.nameHint") }}
        </template>
        <template #action>
          <LoadingButton
            type="submit"
            size="sm"
            :loading="isSubmitting"
            :disabled="!meta.dirty"
          >
            {{ t("panel.common.save") }}
          </LoadingButton>
        </template>
      </SettingsCard>
    </form>

    <EmailCard />
    <PasswordCard />
  </div>
</template>
