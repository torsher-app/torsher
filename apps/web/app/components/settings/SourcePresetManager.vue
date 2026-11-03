<script setup lang="ts">
import type { SourcePreset, SourceSettings } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import * as z from 'zod'
import { toast } from 'vue-sonner'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import SourceOrderList from './SourceOrderList.vue'
import { getErrorMessage } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import LoadingButton from '~/components/LoadingButton.vue'
import { FOLLOW_AUDIOS } from '~/lib/follow'
import { dialogSheetClass } from '~/lib/dialog'
import SettingsCard from './SettingsCard.vue'
import SourcePresetDialog from './SourcePresetDialog.vue'

const props = defineProps<{ settings: SourceSettings, selectedId: string }>()
const emit = defineEmits<{ select: [id: string] }>()
const { t } = useI18n()
const { remove, save } = useSourceSettings()
const preset = computed(() =>
  props.settings.presets.find(item => item.id === props.selectedId)!,
)
const isDefault = computed(
  () => props.selectedId === props.settings.defaultPresetId,
)
const editing = ref<SourcePreset>()
const nameOpen = ref(false)
const deleteOpen = ref(false)
const busy = ref(false)
const error = ref('')
function nameDialog(edit: boolean) {
  editing.value = edit ? preset.value : undefined
  nameOpen.value = true
}
const { handleSubmit, defineField, isSubmitting, meta, resetForm, errors }
  = useForm({
    validationSchema: toTypedSchema(
      z.object({
        audioLanguages: z
          .array(z.enum(FOLLOW_AUDIOS))
          .min(1)
          .refine(
            value => new Set(value).size === value.length,
            t('panel.settings.sources.invalidOrder'),
          ),
        qualities: z
          .array(z.enum(['1080p', '2160p', '720p', 'SD']))
          .length(4)
          .refine(
            value => new Set(value).size === 4,
            t('panel.settings.sources.invalidOrder'),
          ),
        voiceTypes: z
          .array(z.enum(['D', 'MVO', 'DVO', 'AVO', 'VO', 'L']))
          .refine(
            value =>
              value.length === 0
              || (value.length === 6 && new Set(value).size === 6),
            t('panel.settings.sources.invalidOrder'),
          ),
        makeDefault: z.boolean(),
      }),
    ),
    initialValues: values(),
  })
function values() {
  return {
    audioLanguages: [...preset.value.audioLanguages],
    qualities: [...preset.value.qualities],
    voiceTypes: [...preset.value.voiceTypes],
    makeDefault: isDefault.value,
  }
}
const [audioLanguages] = defineField('audioLanguages')
const [qualities] = defineField('qualities')
const [voiceTypes] = defineField('voiceTypes')
const [makeDefault] = defineField('makeDefault')
const availableLanguages = computed(() =>
  FOLLOW_AUDIOS.filter(language => !audioLanguages.value?.includes(language)),
)
function addLanguage(value: unknown) {
  const language = FOLLOW_AUDIOS.find(item => item === value)
  if (language && !audioLanguages.value?.includes(language))
    audioLanguages.value = [...(audioLanguages.value ?? []), language]
}
const locked = computed(() => busy.value || isSubmitting.value)
watch(
  () => props.settings,
  () => {
    if (!meta.value.dirty)
      resetForm({ values: values() })
  },
)
function reset() {
  error.value = ''
  resetForm({ values: values() })
}
const onSubmit = handleSubmit(async (values) => {
  error.value = ''
  try {
    await withErrorMode('silent', () => save(props.selectedId, values))
    reset()
    toast.success(t('panel.settings.sources.saved'))
  }
  catch (err) {
    error.value = await getErrorMessage(err)
  }
})
async function removePreset() {
  busy.value = true
  error.value = ''
  try {
    const result = await withErrorMode('silent', () =>
      remove(props.selectedId))
    deleteOpen.value = false
    emit('select', result.defaultPresetId)
  }
  catch (err) {
    error.value = await getErrorMessage(err)
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard
      :sticky-footer="meta.dirty"
      :title="t('panel.settings.sources.presetsTitle')"
      :description="t('panel.settings.sources.presetsDescription')"
    >
      <template #badge>
        <Badge v-if="meta.dirty" variant="warning">
          {{ t("panel.settings.sources.unsaved") }}
        </Badge>
      </template>
      <Alert v-if="error && !deleteOpen" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
      <Select
        :model-value="selectedId"
        :disabled="locked || meta.dirty"
        @update:model-value="emit('select', String($event))"
      >
        <SelectTrigger
          class="w-full max-w-80"
          :aria-label="t('panel.settings.sources.presetsTitle')"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="item in settings.presets"
            :key="item.id"
            :value="item.id"
          >
            {{ item.name
            }}{{
              item.id === settings.defaultPresetId
                ? ` · ${t("panel.settings.sources.serverDefault")}`
                : ""
            }}
          </SelectItem>
        </SelectContent>
      </Select>
      <div class="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="locked || meta.dirty"
          @click="nameDialog(false)"
        >
          {{ t("panel.settings.sources.create") }}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="locked || meta.dirty"
          @click="nameDialog(true)"
        >
          {{ t("panel.settings.sources.rename") }}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="locked || meta.dirty || isDefault"
          @click="
            deleteOpen = true;
            error = '';
          "
        >
          {{ t("panel.common.delete") }}
        </Button>
      </div>
      <div class="grid gap-6 border-t pt-5 sm:grid-cols-2">
        <div class="grid content-start gap-2">
          <SourceOrderList
            v-model="qualities"
            field="qualities"
            :disabled="locked"
          />
          <p v-if="errors.qualities" class="text-sm text-destructive">
            {{ errors.qualities }}
          </p>
        </div>
        <div class="grid content-start gap-2">
          <h3 class="text-sm font-semibold">
            {{ t("panel.settings.sources.audio") }}
          </h3>
          <SourceOrderList
            v-model="audioLanguages"
            field="audioLanguages"
            :disabled="locked"
          />
          <Select
            v-if="availableLanguages.length"
            model-value=""
            :disabled="locked"
            @update:model-value="addLanguage"
          >
            <SelectTrigger
              :aria-label="t('panel.settings.sources.addLanguage')"
            >
              <SelectValue
                :placeholder="t('panel.settings.sources.addLanguage')"
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="language in availableLanguages"
                :key="language"
                :value="language"
              >
                {{ t(`audioLanguages.${language}`) }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="errors.audioLanguages" class="text-sm text-destructive">
            {{ errors.audioLanguages }}
          </p>
          <SourceOrderList
            v-model="voiceTypes"
            field="voiceTypes"
            :disabled="locked"
          />
          <Button
            v-if="!voiceTypes?.length"
            type="button"
            variant="outline"
            size="sm"
            :disabled="locked"
            @click="voiceTypes = ['D', 'MVO', 'DVO', 'AVO', 'VO', 'L']"
          >
            {{ t("panel.settings.sources.enableTypes") }}
          </Button>
          <p v-if="errors.voiceTypes" class="text-sm text-destructive">
            {{ errors.voiceTypes }}
          </p>
        </div>
      </div>
      <div class="grid gap-2 border-t pt-5">
        <div class="flex items-center gap-2">
          <Checkbox
            id="source-preset-default"
            v-model="makeDefault"
            :disabled="locked || isDefault"
          />
          <Label for="source-preset-default">{{
            t("panel.settings.sources.serverDefault")
          }}</Label>
        </div>
        <p class="text-sm text-muted-foreground">
          {{ t("panel.settings.sources.defaultHint") }}
        </p>
      </div>
      <template #hint>
        {{
          t(
            meta.dirty
              ? "panel.settings.sources.saveHint"
              : "panel.settings.sources.orderHint",
          )
        }}
      </template>
      <template #action>
        <div class="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="locked || !meta.dirty"
            @click="reset"
          >
            {{ t("panel.common.cancel") }}
          </Button>
          <LoadingButton
            type="submit"
            size="sm"
            :loading="isSubmitting"
            :disabled="busy || !meta.dirty"
          >
            {{ t("panel.common.save") }}
          </LoadingButton>
        </div>
      </template>
    </SettingsCard>
  </form>
  <SourcePresetDialog
    v-model:open="nameOpen"
    :preset="editing"
    @select="emit('select', $event)"
  />
  <Dialog v-model:open="deleteOpen">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>
          {{
            t("panel.settings.sources.deleteTitle", { name: preset.name })
          }}
        </DialogTitle><DialogDescription>
          {{ t("panel.settings.sources.deleteHint") }}
        </DialogDescription>
      </DialogHeader>
      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
      <DialogFooter>
        <Button
          variant="outline"
          :disabled="locked || meta.dirty"
          @click="deleteOpen = false"
        >
          {{ t("panel.common.cancel") }}
        </Button>
        <LoadingButton
          variant="destructive"
          :loading="busy"
          @click="removePreset"
        >
          {{ t("panel.common.delete") }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
