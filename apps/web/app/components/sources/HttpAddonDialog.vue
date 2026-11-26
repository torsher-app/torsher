<script setup lang="ts">
import type {
  HttpAddon,
  HttpAddonCapabilities,
  HttpAddonError,
  HttpAddonPreview,
  HttpAddonSelections,
} from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { getErrorBody } from '@torsher/api-client'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { z } from 'zod'
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
import { dialogSheetClass } from '~/lib/dialog'
import { httpUrlSchema } from '~/lib/sourceForms'
import { api } from '~/services/api'

const props = defineProps<{ addon: HttpAddon | null }>()
const emit = defineEmits<{ saved: [addon: HttpAddon] }>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()

const name = computed(
  () => props.addon?.capabilities.name || props.addon?.origin,
)
const urlError = () => t('panel.sources.validation.url')
const { defineField, errors, handleSubmit, resetForm, validateField } = useForm(
  {
    validationSchema: computed(() =>
      toTypedSchema(
        z.object({
          url: z
            .string()
            .trim()
            .max(8192, urlError())
            .pipe(
              props.addon
                ? z.union([z.literal(''), httpUrlSchema(urlError())])
                : httpUrlSchema(urlError()),
            ),
        }),
      ),
    ),
    initialValues: { url: '' },
  },
)
const [url, urlAttrs] = defineField('url')
const preview = shallowRef<HttpAddonPreview>()
const tested = shallowRef<HttpAddonCapabilities>()
const consent = ref(false)
const busy = ref<'check' | 'save'>()
const problem = ref<HttpAddonError['kind'] | 'unknown'>()
function emptySelections(): HttpAddonSelections {
  return {
    stream: false,
    subtitles: false,
    catalogs: [],
  }
}
const selections = ref(emptySelections())

const visibleCapabilities = computed(
  () =>
    tested.value ?? (url.value?.trim() ? undefined : props.addon?.capabilities),
)
const approvalId = computed(() =>
  consent.value ? preview.value?.approvalId : undefined,
)
const canSave = computed(
  () =>
    !busy.value
    && (url.value?.trim() ? !!tested.value : !!props.addon)
    && (!preview.value?.approvalId || !!approvalId.value),
)
const errorText = computed(() =>
  problem.value === 'address_changed' || problem.value === 'needs_confirmation'
    ? t('addons.addressChanged')
    : problem.value === 'timeout' || problem.value === 'unavailable'
      ? t('panel.sources.errorTitles.unreachable')
      : t('panel.sources.errors.unknown'),
)

let generation = 0
function clearCheck() {
  generation++
  preview.value = undefined
  tested.value = undefined
  consent.value = false
  problem.value = undefined
  busy.value = undefined
}

watch(url, clearCheck, { flush: 'sync' })
watch(
  () => [open.value, props.addon?.id],
  () => {
    resetForm({ values: { url: '' } })
    clearCheck()
    selections.value = props.addon
      ? {
          ...props.addon.selections,
          catalogs: [...props.addon.selections.catalogs],
        }
      : emptySelections()
  },
  { immediate: true, flush: 'sync' },
)

async function failed(error: unknown, run: number) {
  const data = await getErrorBody<Partial<HttpAddonError>>(error)
  if (run !== generation || !open.value)
    return
  problem.value = data?.kind ?? 'unknown'
  if (
    problem.value === 'needs_confirmation'
    || problem.value === 'address_changed'
  ) {
    preview.value = undefined
    consent.value = false
    tested.value = undefined
  }
}

async function check() {
  const inputGeneration = generation
  if (busy.value || !(await validateField('url')).valid || !open.value)
    return
  if (busy.value || generation !== inputGeneration)
    return

  const id = props.addon?.id
  const entered = url.value?.trim()
  const input = { id, url: entered || undefined }
  const run = ++generation
  problem.value = undefined
  tested.value = undefined
  busy.value = 'check'

  try {
    if (!preview.value) {
      const result = await withErrorMode('silent', () =>
        api.sources.previewHttpAddon(input))
      if (run !== generation)
        return
      if (result.approvalId) {
        const known = props.addon?.lanAddresses ?? []
        const sameAddresses
          = result.addresses.length === known.length
            && result.addresses.every(address => known.includes(address))
        if (
          entered
          || props.addon?.checkError === 'needs_confirmation'
          || !sameAddresses
        ) {
          preview.value = result
          return
        }
      }
    }
    if (preview.value?.approvalId && !approvalId.value)
      return

    if (!entered && id) {
      const result = await withErrorMode('silent', () =>
        api.sources.recheckHttpAddon(id, { approvalId: approvalId.value }))
      if (run !== generation)
        return
      emit('saved', result)
      problem.value = result.checkError ?? undefined
      preview.value = undefined
      consent.value = false
      if (result.checkError)
        return
      tested.value = result.capabilities
      return
    }

    const result = await withErrorMode('silent', () =>
      api.sources.testHttpAddon({ ...input, approvalId: approvalId.value }))
    if (run === generation)
      tested.value = result
  }
  catch (error) {
    await failed(error, run)
  }
  finally {
    if (run === generation)
      busy.value = undefined
  }
}

const save = handleSubmit(async ({ url }) => {
  if (!canSave.value)
    return
  const cleanUrl = url || undefined
  const run = ++generation
  problem.value = undefined
  busy.value = 'save'
  try {
    const data = {
      selections: selections.value,
      approvalId: approvalId.value,
    }
    const id = props.addon?.id
    const result = await withErrorMode('silent', () =>
      id
        ? api.sources.patchHttpAddon(id, { ...data, url: cleanUrl })
        : api.sources.postHttpAddon({ ...data, url }))
    if (run !== generation)
      return
    emit('saved', result)
    open.value = false
  }
  catch (error) {
    await failed(error, run)
  }
  finally {
    if (run === generation)
      busy.value = undefined
  }
})

function catalogChanged(key: string, checked: boolean | 'indeterminate') {
  selections.value.catalogs
    = checked === true
      ? [...selections.value.catalogs, key]
      : selections.value.catalogs.filter(value => value !== key)
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>{{ name || t("addons.add") }}</DialogTitle>
        <DialogDescription v-if="addon">
          {{ addon.origin }}
        </DialogDescription>
      </DialogHeader>

      <form
        id="http-addon-form"
        class="grid min-h-0 gap-4 overflow-y-auto px-1"
        @submit="save"
      >
        <Alert v-if="problem" variant="destructive" role="alert">
          <AlertDescription>{{ errorText }}</AlertDescription>
        </Alert>
        <div class="grid gap-2">
          <Label for="http-addon-url">{{ t("addons.manifestUrl") }}</Label>
          <SecretInput
            id="http-addon-url"
            v-model="url"
            v-bind="urlAttrs"
            inputmode="url"
            autocomplete="off"
            spellcheck="false"
            :show-label="t('panel.settings.network.routeDialog.show')"
            :hide-label="t('panel.settings.network.routeDialog.hide')"
            :disabled="!!busy"
            :aria-invalid="!!errors.url"
            :aria-describedby="errors.url ? 'http-addon-url-error' : undefined"
          />
          <p
            v-if="errors.url"
            id="http-addon-url-error"
            class="text-sm text-destructive"
          >
            {{ errors.url }}
          </p>
        </div>

        <fieldset
          v-if="preview?.approvalId"
          class="grid gap-2 rounded-lg border p-3"
        >
          <legend class="px-1 font-medium">
            {{ t("addons.confirmAddresses", { origin: preview.origin }) }}
          </legend>
          <ul class="font-mono text-sm text-muted-foreground">
            <li
              v-for="address in preview.addresses"
              :key="address"
              class="break-all"
            >
              {{ address }}
            </li>
          </ul>
          <div class="flex items-center gap-2">
            <Checkbox
              id="http-addon-local"
              v-model="consent"
              :disabled="!!busy"
            />
            <Label for="http-addon-local">{{ t("addons.allowLocal") }}</Label>
          </div>
        </fieldset>

        <div v-if="visibleCapabilities" class="grid gap-3">
          <p v-if="tested" class="font-medium" role="status">
            {{ tested.name }}
          </p>
          <div
            v-if="visibleCapabilities.stream"
            class="flex items-center gap-2"
          >
            <Checkbox
              id="http-addon-streams"
              v-model="selections.stream"
              :disabled="!!busy"
            />
            <Label for="http-addon-streams">{{ t("addons.streams") }}</Label>
          </div>
          <div
            v-if="visibleCapabilities.subtitles"
            class="flex items-center gap-2"
          >
            <Checkbox
              id="http-addon-subtitles"
              v-model="selections.subtitles"
              :disabled="!!busy"
            />
            <Label for="http-addon-subtitles">{{
              t("player.subtitles")
            }}</Label>
          </div>
          <fieldset
            v-if="visibleCapabilities.catalogs.length"
            class="grid gap-2"
          >
            <legend class="mb-2 font-medium">
              {{ t("addons.catalogs") }}
            </legend>
            <div
              v-for="catalog in visibleCapabilities.catalogs"
              :key="catalog.key"
              class="flex items-center gap-2"
            >
              <Checkbox
                :id="`http-addon-catalog-${catalog.key}`"
                :model-value="selections.catalogs.includes(catalog.key)"
                :disabled="!!busy"
                @update:model-value="catalogChanged(catalog.key, $event)"
              />
              <Label :for="`http-addon-catalog-${catalog.key}`">{{
                catalog.name
              }}</Label>
            </div>
          </fieldset>
        </div>
      </form>

      <DialogFooter>
        <Button variant="outline" :disabled="!!busy" @click="open = false">
          {{ t("panel.common.cancel") }}
        </Button>
        <LoadingButton
          variant="outline"
          :loading="busy === 'check'"
          :disabled="!!busy || (!!preview?.approvalId && !consent)"
          @click="check"
        >
          {{ t("addons.test") }}
        </LoadingButton>
        <LoadingButton
          form="http-addon-form"
          type="submit"
          :loading="busy === 'save'"
          :disabled="!canSave"
        >
          {{ t("panel.common.save") }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
