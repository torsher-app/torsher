<script setup lang="ts">
import type { TorrentSettings } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import LoadingButton from '~/components/LoadingButton.vue'
import SettingsCard from './SettingsCard.vue'
import TorrentRestartBadge from './TorrentRestartBadge.vue'

const props = defineProps<{ settings: TorrentSettings }>()
const { t } = useI18n()
const { load, save } = useTorrentSettings()
const key = 'panel.settings.torrent.binding'
const current = computed(() => props.settings.networkBinding)
const env = computed(() => props.settings.bindInterfaceEnv)
const interfaces = computed(
  () => current.value?.interfaces.filter(item => !item.loopback) ?? [],
)
const description = computed(() => {
  if (current.value?.status === 'bound') {
    return t(`${key}.bound`, { interface: current.value.bindInterface })
  }
  if (current.value && current.value.status !== 'unbound') {
    return t(`${key}.offline`)
  }
  if (!current.value && props.settings.values.bindInterface) {
    return t('panel.overview.attention.engine_bind_unavailable')
  }
  return t(`${key}.any`)
})

const fieldError = () => t('panel.notifications.validation.invalid')
const { handleSubmit, defineField, errors, isSubmitting, meta, resetForm }
  = useForm({
    validationSchema: toTypedSchema(
      z.object({
        bindInterface: z
          .string()
          .trim()
          .max(15, fieldError())
          .regex(/^(?!\.{1,2}$)[\w.@-]*$/, fieldError()),
      }),
    ),
    initialValues: { bindInterface: props.settings.values.bindInterface },
  })

const [bindInterface, fieldProps] = defineField('bindInterface')

watch(
  () => props.settings.values.bindInterface,
  (value) => {
    if (!meta.value.dirty)
      resetForm({ values: { bindInterface: value } })
  },
)

const onSubmit = handleSubmit(async ({ bindInterface }) => {
  if (env.value)
    return
  await save({ bindInterface })
  resetForm({ values: { bindInterface: props.settings.values.bindInterface } })
  toast.success(t('panel.settings.torrent.saved'), {
    description: t('panel.settings.torrent.savedRestart'),
  })
})
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard :title="t(`${key}.title`)" :description="description">
      <template #badge>
        <TorrentRestartBadge v-if="!env" />
      </template>
      <div class="grid gap-2">
        <Label for="torrent-interface" class="sr-only">{{
          t(`${key}.title`)
        }}</Label>
        <Input
          v-if="env"
          id="torrent-interface"
          :model-value="env"
          class="w-full max-w-72 font-mono"
          readonly
        />
        <Input
          v-else
          id="torrent-interface"
          v-model="bindInterface"
          v-bind="fieldProps"
          list="torrent-interfaces"
          :placeholder="t(`${key}.any`)"
          :aria-invalid="!!errors.bindInterface || undefined"
          :aria-describedby="
            errors.bindInterface ? 'torrent-interface-error' : undefined
          "
          maxlength="15"
          autocomplete="off"
          autocapitalize="off"
          :spellcheck="false"
          class="w-full max-w-72 font-mono"
        />
        <datalist id="torrent-interfaces">
          <option
            v-for="item in interfaces"
            :key="item.name"
            :value="item.name"
          >
            {{ [...item.ipv4, ...item.ipv6].join(", ") }}
          </option>
        </datalist>
        <p v-if="env" class="text-xs text-muted-foreground">
          {{ t(`${key}.env`) }}
        </p>
        <p
          v-else-if="errors.bindInterface"
          id="torrent-interface-error"
          class="text-xs text-destructive"
        >
          {{ errors.bindInterface }}
        </p>
      </div>
      <template #action>
        <div class="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" @click="load">
            {{ t("sources.refresh") }}
          </Button>
          <LoadingButton
            v-if="!env"
            type="submit"
            size="sm"
            :loading="isSubmitting"
            :disabled="!meta.dirty"
          >
            {{ t("panel.common.save") }}
          </LoadingButton>
        </div>
      </template>
    </SettingsCard>
  </form>
</template>
