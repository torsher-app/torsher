<script setup lang="ts">
import type { NetRoute } from '@torsher/api-client'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import LoadingButton from '~/components/LoadingButton.vue'
import SecretInput from '~/components/SecretInput.vue'
import { netRouteError } from '~/composables/useNetwork'
import { dialogSheetClass } from '~/lib/dialog'
import { httpsUrlSchema, isValidMatch, proxyProblem } from '~/lib/netForms'
import { getErrorMessage } from '~/services/api'
import NetworkDnsSelect from './NetworkDnsSelect.vue'

const props = defineProps<{
  /** Маршрут для правки; без него диалог добавляет новый */
  route?: NetRoute | null
  /** Хост, для которого создаётся маршрут из списка хостов */
  presetMatch?: string
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { createRoute, updateRoute } = useNetwork()

const VIAS = ['direct', 'socks5h', 'http'] as const

const isEdit = computed(() => !!props.route)
const formError = ref('')
// Сохранённые логин и пароль удалятся при сохранении
const forgetCredentials = ref(false)
const hasCredentials = computed(
  () => !!props.route && (props.route.hasUsername || props.route.hasPassword),
)

const credential = z.string().max(300)

// Те же правила, что у сервера: ошибка, которую он всё же вернёт, встанет у своего поля
const schema = toTypedSchema(
  z
    .object({
      match: z
        .string()
        .trim()
        .min(1, t('panel.settings.network.validation.match'))
        .max(253),
      via: z.enum(VIAS),
      proxy: z.string().trim().max(300),
      username: credential,
      password: credential,
      dns: z.enum(['system', 'quad9', 'google', 'cloudflare', 'custom']),
      dohUrl: z.string().trim(),
    })
    .superRefine((values, ctx) => {
      if (values.match && !isValidMatch(values.match)) {
        ctx.addIssue({
          code: 'custom',
          path: ['match'],
          message: t('panel.settings.network.validation.match'),
        })
      }

      if (values.via !== 'direct') {
        const problem = values.proxy
          ? proxyProblem(values.via, values.proxy)
          : 'format'

        if (problem) {
          ctx.addIssue({
            code: 'custom',
            path: ['proxy'],
            message: t(`panel.settings.network.validation.proxy.${problem}`),
          })
        }
      }

      if (
        values.via === 'direct'
        && values.dns === 'custom'
        && !httpsUrlSchema('').safeParse(values.dohUrl).success
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['dohUrl'],
          message: t('panel.settings.network.validation.dohUrl'),
        })
      }
    }),
)

const {
  handleSubmit,
  defineField,
  errors,
  isSubmitting,
  resetForm,
  setFieldError,
} = useForm({ validationSchema: schema })

const [match, matchProps] = defineField('match')
const [via, viaProps] = defineField('via')
const [proxy, proxyProps] = defineField('proxy')
const [username, usernameProps] = defineField('username')
const [password, passwordProps] = defineField('password')
const [dns] = defineField('dns')
const [dohUrl, dohUrlProps] = defineField('dohUrl')

watch(open, (isOpen) => {
  if (!isOpen)
    return

  const route = props.route

  resetForm({
    values: {
      match: route?.match ?? props.presetMatch ?? '',
      via: route?.via ?? 'direct',
      proxy: route?.proxy ?? '',
      username: '',
      password: '',
      dns: route?.dns ?? 'system',
      dohUrl: route?.dohUrl ?? '',
    },
  })
  formError.value = ''
  forgetCredentials.value = false
})

const viaHint = computed(() =>
  t(`panel.settings.network.viaText.${via.value ?? 'direct'}`),
)
const proxyPlaceholder = computed(() =>
  via.value === 'http' ? '192.168.1.10:3128' : '192.168.1.10:1080',
)

const onSubmit = handleSubmit(async (values) => {
  formError.value = ''

  const proxied = values.via !== 'direct'
  const custom = !proxied && values.dns === 'custom'

  try {
    if (props.route) {
      const secret = (value: string) =>
        forgetCredentials.value ? null : value || undefined

      await updateRoute(props.route.id, {
        match: props.route.isDefault ? undefined : values.match,
        via: values.via,
        proxy: proxied ? values.proxy : undefined,
        username: proxied ? secret(values.username) : undefined,
        password: proxied ? secret(values.password) : undefined,
        dns: values.dns,
        dohUrl: custom ? values.dohUrl : undefined,
      })
      open.value = false
      toast.success(t('panel.settings.network.routeDialog.saved'))
      return
    }

    const created = await createRoute({
      match: values.match,
      via: values.via,
      proxy: proxied ? values.proxy : undefined,
      username: proxied ? values.username || undefined : undefined,
      password: proxied ? values.password || undefined : undefined,
      dns: values.dns,
      dohUrl: custom ? values.dohUrl : undefined,
    })

    open.value = false
    toast.success(
      t('panel.settings.network.routeDialog.added', { match: created.match }),
    )
  }
  catch (err) {
    const error = await netRouteError(err)

    if (error) {
      setFieldError(
        error.field,
        t(`panel.settings.network.serverErrors.${error.kind}.${error.field}`),
      )
    }
    else {
      formError.value = await getErrorMessage(err)
    }
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
              ? t("panel.settings.network.routeDialog.editTitle")
              : t("panel.settings.network.routeDialog.addTitle")
          }}
        </DialogTitle>
        <DialogDescription>
          {{ t("panel.settings.network.routeDialog.description") }}
        </DialogDescription>
      </DialogHeader>

      <form id="net-route" class="grid gap-4" novalidate @submit="onSubmit">
        <Alert v-if="formError" variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>
            {{ t("panel.settings.network.routeDialog.failed") }}
          </AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <div class="grid gap-2">
          <Label for="net-route-match">{{
            t("panel.settings.network.routeDialog.match")
          }}</Label>
          <Input
            id="net-route-match"
            v-model="match"
            v-bind="matchProps"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            class="font-mono"
            placeholder="*.indexer.example"
            :readonly="route?.isDefault"
            :aria-invalid="!!errors.match || undefined"
            aria-describedby="net-route-match-hint"
          />
          <p
            v-if="errors.match"
            id="net-route-match-hint"
            class="text-[12.5px] text-destructive"
          >
            {{ errors.match }}
          </p>
          <p
            v-else
            id="net-route-match-hint"
            class="text-[12.5px] text-muted-foreground"
          >
            {{
              route?.isDefault
                ? t("panel.settings.network.routeDialog.matchDefault")
                : t("panel.settings.network.routeDialog.matchHint")
            }}
          </p>
        </div>

        <div class="grid gap-2">
          <Label id="net-route-via-label">{{
            t("panel.settings.network.routeDialog.via")
          }}</Label>
          <RadioGroup
            v-model="via"
            v-bind="viaProps"
            class="grid gap-2 sm:grid-cols-3"
            aria-labelledby="net-route-via-label"
            aria-describedby="net-route-via-hint"
          >
            <Label
              v-for="item in VIAS"
              :key="item"
              :for="`net-route-via-${item}`"
              class="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-input px-2.5 py-2.5 font-normal whitespace-nowrap has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary"
            >
              <span class="font-semibold">{{
                t(`panel.settings.network.via.${item}`)
              }}</span>
              <RadioGroupItem :id="`net-route-via-${item}`" :value="item" />
            </Label>
          </RadioGroup>
          <p
            id="net-route-via-hint"
            class="text-[12.5px] text-muted-foreground"
          >
            {{ viaHint }}
          </p>
        </div>

        <template v-if="via !== 'direct'">
          <div class="grid gap-2">
            <Label for="net-route-proxy">{{
              t("panel.settings.network.routeDialog.proxy")
            }}</Label>
            <Input
              id="net-route-proxy"
              v-model="proxy"
              v-bind="proxyProps"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              class="font-mono"
              :placeholder="proxyPlaceholder"
              :aria-invalid="!!errors.proxy || undefined"
              aria-describedby="net-route-proxy-hint"
            />
            <p
              v-if="errors.proxy"
              id="net-route-proxy-hint"
              class="text-[12.5px] text-destructive"
            >
              {{ errors.proxy }}
            </p>
            <p
              v-else
              id="net-route-proxy-hint"
              class="text-[12.5px] text-muted-foreground"
            >
              {{ t("panel.settings.network.routeDialog.proxyHint") }}
            </p>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div class="grid gap-2">
              <div class="flex items-baseline justify-between gap-3">
                <Label for="net-route-username">{{
                  t("panel.settings.network.routeDialog.username")
                }}</Label>
                <span class="text-[12.5px] text-muted-foreground">{{
                  t("panel.common.optional")
                }}</span>
              </div>
              <SecretInput
                id="net-route-username"
                v-model="username"
                v-bind="usernameProps"
                autocomplete="off"
                :disabled="forgetCredentials"
                :show-label="t('panel.settings.network.routeDialog.show')"
                :hide-label="t('panel.settings.network.routeDialog.hide')"
              />
            </div>
            <div class="grid gap-2">
              <div class="flex items-baseline justify-between gap-3">
                <Label for="net-route-password">{{
                  t("panel.settings.network.routeDialog.password")
                }}</Label>
                <span class="text-[12.5px] text-muted-foreground">{{
                  t("panel.common.optional")
                }}</span>
              </div>
              <SecretInput
                id="net-route-password"
                v-model="password"
                v-bind="passwordProps"
                autocomplete="off"
                :disabled="forgetCredentials"
                :show-label="t('panel.settings.network.routeDialog.show')"
                :hide-label="t('panel.settings.network.routeDialog.hide')"
              />
            </div>
          </div>
          <p
            class="-mt-2 flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted-foreground"
          >
            <template v-if="forgetCredentials">
              {{ t("panel.settings.network.routeDialog.credentialsForget") }}
            </template>
            <template v-else-if="hasCredentials">
              {{ t("panel.settings.network.routeDialog.credentialsSaved") }}
            </template>
            <template v-else>
              {{ t("panel.settings.network.routeDialog.credentialsHint") }}
            </template>
            <Button
              v-if="hasCredentials"
              type="button"
              variant="link"
              size="xs"
              class="h-auto px-0"
              @click="forgetCredentials = !forgetCredentials"
            >
              {{
                forgetCredentials
                  ? t("panel.settings.network.routeDialog.keepCredentials")
                  : t("panel.settings.network.routeDialog.forgetCredentials")
              }}
            </Button>
          </p>
        </template>

        <div v-if="via === 'direct'" class="grid gap-2">
          <Label for="net-route-dns">{{
            t("panel.settings.network.routeDialog.dns")
          }}</Label>
          <NetworkDnsSelect id="net-route-dns" v-model="dns" />
        </div>
        <p v-else class="text-[12.5px] text-muted-foreground">
          {{ t("panel.settings.network.routeDialog.dnsProxy") }}
        </p>

        <div v-if="via === 'direct' && dns === 'custom'" class="grid gap-2">
          <Label for="net-route-doh">{{
            t("panel.settings.network.routeDialog.dohUrl")
          }}</Label>
          <Input
            id="net-route-doh"
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
      </form>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="isSubmitting"
          @click="open = false"
        >
          {{ t("panel.common.cancel") }}
        </Button>
        <LoadingButton type="submit" form="net-route" :loading="isSubmitting">
          {{
            isEdit
              ? t("panel.common.save")
              : t("panel.settings.network.routeDialog.submit")
          }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
