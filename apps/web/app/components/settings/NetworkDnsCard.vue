<script setup lang="ts">
import type { NetRoute } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import LoadingButton from '~/components/LoadingButton.vue'
import { netRouteError } from '~/composables/useNetwork'
import { httpsUrlSchema } from '~/lib/netForms'
import { getErrorMessage } from '~/services/api'
import NetworkDnsSelect from './NetworkDnsSelect.vue'
import SettingsCard from './SettingsCard.vue'

/** DNS по умолчанию — это DNS маршрута `*`: хостов без своего маршрута */
const props = defineProps<{
  route: NetRoute
}>()

const { t } = useI18n()
const { providers, updateRoute } = useNetwork()

const dnsSchema = z.enum(['system', 'quad9', 'google', 'cloudflare', 'custom'])

const schema = toTypedSchema(
  z
    .object({
      dns: dnsSchema,
      dohUrl: z.string().trim(),
    })
    .superRefine((values, ctx) => {
      if (values.dns !== 'custom')
        return

      const url = httpsUrlSchema('').safeParse(values.dohUrl)

      if (!values.dohUrl || !url.success) {
        ctx.addIssue({
          code: 'custom',
          path: ['dohUrl'],
          message: t('panel.settings.network.validation.dohUrl'),
        })
      }
    }),
)

function valuesOf(route: NetRoute) {
  return { dns: route.dns, dohUrl: route.dohUrl ?? '' }
}

const {
  handleSubmit,
  defineField,
  errors,
  isSubmitting,
  meta,
  resetForm,
  setFieldError,
} = useForm({
  validationSchema: schema,
  initialValues: valuesOf(props.route),
})

const [dns] = defineField('dns')
const [dohUrl, dohUrlProps] = defineField('dohUrl')

watch(
  () => props.route,
  (route) => {
    if (!meta.value.dirty)
      resetForm({ values: valuesOf(route) })
  },
)

const providerUrl = computed(
  () => providers.value.find(item => item.id === dns.value)?.url,
)

const onSubmit = handleSubmit(async (values) => {
  try {
    const saved = await updateRoute(props.route.id, {
      dns: values.dns,
      dohUrl: values.dns === 'custom' ? values.dohUrl : undefined,
    })

    resetForm({ values: valuesOf(saved) })
    toast.success(t('panel.settings.network.dnsCard.saved'), {
      description: t('panel.settings.network.dnsCard.savedText'),
    })
  }
  catch (err) {
    const error = await netRouteError(err)

    if (error?.field === 'dohUrl')
      setFieldError('dohUrl', t('panel.settings.network.validation.dohUrl'))
    else toast.error(await getErrorMessage(err))
  }
})
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard
      :title="t('panel.settings.network.dnsCard.title')"
      :description="t('panel.settings.network.dnsCard.text')"
    >
      <div class="grid gap-2">
        <Label for="net-default-dns" class="sr-only">
          {{ t("panel.settings.network.dnsCard.title") }}
        </Label>
        <NetworkDnsSelect id="net-default-dns" v-model="dns" />
      </div>
      <div v-if="dns === 'custom'" class="grid gap-2">
        <Label for="net-default-doh">{{
          t("panel.settings.network.routeDialog.dohUrl")
        }}</Label>
        <Input
          id="net-default-doh"
          v-model="dohUrl"
          v-bind="dohUrlProps"
          type="url"
          inputmode="url"
          autocomplete="off"
          class="font-mono"
          placeholder="https://doh.example/dns-query"
          :aria-invalid="!!errors.dohUrl || undefined"
        />
        <p v-if="errors.dohUrl" class="text-[12.5px] text-destructive">
          {{ errors.dohUrl }}
        </p>
        <p v-else class="text-[12.5px] text-muted-foreground">
          {{ t("panel.settings.network.routeDialog.dohUrlHint") }}
        </p>
      </div>
      <template #hint>
        <template v-if="route.envProxy">
          {{ t("panel.settings.network.dnsCard.envProxyNote") }}
        </template>
        <template v-else-if="route.via !== 'direct'">
          {{ t("panel.settings.network.dnsCard.proxyNote") }}
        </template>
        <span v-else-if="providerUrl" class="font-mono">{{ providerUrl }}</span>
        <template v-else-if="dns === 'system'">
          {{ t("panel.settings.network.dnsCard.systemHint") }}
        </template>
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
</template>
