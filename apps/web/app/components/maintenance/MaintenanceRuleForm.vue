<script setup lang="ts">
import type { MaintenanceRuleOptionsInput } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
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
import { dialogSheetClass } from '~/lib/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import LoadingButton from '~/components/LoadingButton.vue'
import MaintenancePreview from './MaintenancePreview.vue'

const props = defineProps<{ titleId: string, kind: 'movie' | 'series' }>()
const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n()
const common = computed(() => props.titleId === 'default')
const { follows } = useFollows()
const titleNames = computed(
  () =>
    new Map(
      follows.value.map(item => [item.titleId, item.title ?? item.titleId]),
    ),
)
const reverting = ref(false)
const {
  config,
  preview,
  commonPreview,
  inherit,
  previewInherited,
  status,
  busy,
  error,
  detail,
  load,
  evaluate,
  save,
  protect,
  unsuppress,
} = useLibraryMaintenance(() => props.titleId)
const { defineField, handleSubmit, resetForm, values, errors, meta } = useForm({
  validationSchema: toTypedSchema(
    z.object({
      enabled: z.boolean(),
      days: z.number().int().min(1).max(36500),
      keepLast: z.union([z.literal(''), z.number().int().min(1).max(10000)]),
      profileIds: z.array(z.string().min(1)).min(1).max(1000),
    }),
  ),
  initialValues: {
    enabled: false,
    days: 30,
    keepLast: '' as '' | number,
    profileIds: [] as string[],
  },
})
const [enabled] = defineField('enabled')
const [days] = defineField('days')
const [keepLast] = defineField('keepLast')
const [profileIds] = defineField('profileIds')
const confirming = ref(false)
const previewValues = ref('')
watch(confirming, (open) => {
  if (!open && reverting.value) {
    reverting.value = false
    preview.value = null
    previewValues.value = ''
  }
})
const stale = computed(() => previewValues.value !== JSON.stringify(values))
const loading = useHeldLoading(() => busy.value && !config.value)
const suppressions = computed(
  () =>
    status.value?.suppressions.filter(s => s.titleId === props.titleId) ?? [],
)
function options(): MaintenanceRuleOptionsInput {
  return {
    enabled: !!values.enabled,
    days: Number(values.days),
    keepLast:
      props.kind === 'movie' || values.keepLast === ''
        ? null
        : Number(values.keepLast),
    profileIds: values.profileIds ?? [],
  }
}
async function reload() {
  previewValues.value = ''
  const result = await load()
  if (result) {
    resetForm({
      values: {
        enabled:
          (common.value && result.rule.revision === 0) || result.rule.enabled,
        days: result.rule.days,
        keepLast: result.rule.keepLast ?? '',
        profileIds: result.rule.profileIds.filter(id =>
          result.profiles.some(profile => profile.id === id),
        ),
      },
    })
  }
  confirming.value = false
}
const showPreview = handleSubmit(async () => {
  const snapshot = JSON.stringify(values)
  if (await evaluate(options()))
    previewValues.value = snapshot
})
const submit = handleSubmit(async () => {
  reverting.value = false
  if (
    values.enabled
    && (common.value || config.value?.inherited || !config.value?.rule.enabled)
  ) {
    const snapshot = JSON.stringify(values)
    if (await evaluate(options())) {
      previewValues.value = snapshot
      confirming.value = true
    }
    return
  }
  await persist()
})
async function requestInheritance() {
  const snapshot = JSON.stringify(values)
  if (await previewInherited()) {
    reverting.value = true
    previewValues.value = snapshot
    confirming.value = true
  }
}
const candidateCount = computed(
  () =>
    (common.value
      ? commonPreview.value?.items.flatMap(item => item.preview.groups)
      : preview.value?.groups
    )?.filter(group => group.candidate).length ?? 0,
)
async function persist() {
  const result = reverting.value ? await inherit() : await save(options())
  if (result) {
    resetForm({
      values: {
        enabled: result.rule.enabled,
        days: result.rule.days,
        keepLast: result.rule.keepLast ?? '',
        profileIds: result.rule.profileIds.filter(id =>
          result.profiles.some(profile => profile.id === id),
        ),
      },
    })
    confirming.value = false
    previewValues.value = ''
    emit('saved')
  }
}
watch(
  values,
  () => {
    confirming.value = false
  },
  { deep: true },
)
watch(() => props.titleId, reload, { immediate: true })
</script>

<template>
  <section class="grid gap-3">
    <p class="text-sm text-muted-foreground">
      {{
        t(
          common
            ? "panel.maintenance.commonScope"
            : config?.inherited
              ? "panel.maintenance.inheritedHint"
              : "panel.maintenance.overrideHint",
        )
      }}
    </p>
    <details class="text-xs text-muted-foreground">
      <summary>{{ t("panel.maintenance.scopeTitle") }}</summary>
      <p class="mt-1">
        {{ t("panel.maintenance.scope") }}
      </p>
    </details>
    <Alert v-if="error" variant="destructive">
      <AlertDescription>
        {{ t(`panel.maintenance.${error}`) }}
        <details v-if="detail">
          <summary>{{ t("panel.maintenance.details") }}</summary>
          <p class="break-all">
            {{ detail }}
          </p>
        </details>
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="busy"
          @click="reload"
        >
          {{ t("panel.maintenance.reload") }}
        </Button>
      </AlertDescription>
    </Alert>
    <Skeleton v-if="loading" class="h-48" />
    <form v-else-if="config" class="grid gap-3" @submit="submit">
      <p
        v-if="!config.executorAvailable || !status?.executorEnabled"
        class="text-[12.5px] text-muted-foreground"
      >
        {{
          t(
            !config.executorAvailable
              ? "panel.maintenance.unavailable"
              : "panel.maintenance.executionOff",
          )
        }}
      </p>
      <p v-if="config.rule.rosterChanged" role="alert">
        {{ t("panel.maintenance.rosterChanged") }}
      </p>
      <div class="flex items-center justify-between gap-3">
        <Label :for="`maintenance-enabled-${titleId}`">{{
          t(
            common
              ? "panel.maintenance.enableDefault"
              : "panel.maintenance.enabled",
          )
        }}</Label><Switch
          :id="`maintenance-enabled-${titleId}`"
          v-model="enabled"
          :disabled="busy"
        />
      </div>
      <div class="grid gap-2">
        <Label :for="`maintenance-days-${titleId}`">{{
          t("panel.maintenance.days")
        }}</Label><Input
          :id="`maintenance-days-${titleId}`"
          v-model.number="days"
          type="number"
          min="1"
          max="36500"
          :disabled="busy"
          :aria-invalid="!!errors.days"
        />
        <p v-if="errors.days" class="text-xs text-destructive">
          {{ t("panel.maintenance.daysError") }}
        </p>
      </div>
      <div v-if="kind === 'series'" class="grid gap-2">
        <Label :for="`maintenance-latest-${titleId}`">{{
          t("panel.maintenance.keepLast")
        }}</Label><Input
          :id="`maintenance-latest-${titleId}`"
          v-model.number="keepLast"
          type="number"
          min="1"
          max="10000"
          :disabled="busy"
          :aria-invalid="!!errors.keepLast"
        />
        <p class="text-xs text-muted-foreground">
          {{ t("panel.maintenance.keepHint") }}
        </p>
        <p v-if="errors.keepLast" class="text-xs text-destructive">
          {{ t("panel.maintenance.keepError") }}
        </p>
      </div>
      <fieldset class="grid gap-2">
        <legend class="mb-2 text-sm font-medium">
          {{ t("panel.maintenance.profiles") }}
        </legend>
        <Label
          v-for="profile in config.profiles"
          :key="profile.id"
          class="flex items-center gap-2"
        ><Checkbox
          :model-value="(profileIds ?? []).includes(profile.id)"
          :disabled="busy"
          @update:model-value="
            (checked) =>
              (profileIds = checked
                ? [...(profileIds ?? []), profile.id]
                : (profileIds ?? []).filter((id) => id !== profile.id))
          "
        />{{ profile.name }}</Label>
        <p v-if="errors.profileIds" class="text-xs text-destructive">
          {{ t("panel.maintenance.profilesError") }}
        </p>
      </fieldset>
      <div class="flex flex-wrap gap-2">
        <LoadingButton
          type="submit"
          size="sm"
          :loading="busy"
          :disabled="
            !meta.dirty
              && !config.rule.rosterChanged
              && !config.inherited
              && config.rule.revision > 0
          "
        >
          {{ t("panel.common.save") }}
        </LoadingButton><Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="busy"
          @click="showPreview"
        >
          {{ t("panel.maintenance.preview") }}
        </Button>
      </div>
      <Button
        v-if="!common && !config.inherited"
        variant="ghost"
        size="sm"
        type="button"
        :disabled="busy"
        @click="requestInheritance"
      >
        {{ t("panel.maintenance.useCommon") }}
      </Button>
      <template v-if="common && commonPreview">
        <p role="status" class="text-sm">
          {{
            t("panel.maintenance.coverage", {
              count: commonPreview.titleCount,
              candidates: candidateCount,
            })
          }}
        </p>
        <p v-if="stale" class="text-warning">
          {{ t("panel.maintenance.stale") }}
        </p>
        <div
          v-for="item in commonPreview.items"
          :key="item.titleId"
          class="grid gap-2"
        >
          <h4 class="font-medium">
            {{ titleNames.get(item.titleId) ?? item.titleId }}
          </h4>
          <MaintenancePreview
            :preview="item.preview"
            :busy="busy"
            :stale="stale"
            @protect="(group) => protect(group, options())"
          />
        </div>
      </template>
      <MaintenancePreview
        v-if="!common && preview"
        :preview="preview"
        :busy="busy"
        :stale="stale"
        @protect="(group) => protect(group, options())"
      />
      <AlertDialog v-model:open="confirming">
        <AlertDialogContent :class="dialogSheetClass">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {{
                t(
                  reverting
                    ? "panel.maintenance.useCommon"
                    : common
                      ? "panel.maintenance.saveDefault"
                      : "panel.maintenance.confirmEnable",
                )
              }}
            </AlertDialogTitle><AlertDialogDescription>
              {{
                t(
                  reverting
                    ? "panel.maintenance.confirmInherit"
                    : common
                      ? "panel.maintenance.confirmDefault"
                      : "panel.maintenance.confirmRule",
                )
              }}
            </AlertDialogDescription>
            <p v-if="reverting && status" class="text-sm text-muted-foreground">
              {{
                status.defaultRule.enabled
                  ? t("panel.maintenance.ruleDays", {
                    days: status.defaultRule.days,
                  })
                  : t("panel.maintenance.commonOff")
              }}
            </p>
            <p class="text-sm text-muted-foreground">
              {{ t("panel.maintenance.profiles") }}:
              {{
                config.profiles
                  .filter((profile) =>
                    (reverting
                      ? status?.defaultRule.profileIds
                      : profileIds
                    )?.includes(profile.id),
                  )
                  .map((profile) => profile.name)
                  .join(", ")
              }}
            </p>
            <p
              v-if="preview || commonPreview"
              class="text-sm text-muted-foreground"
            >
              {{
                t("panel.maintenance.previewCount", {
                  count: candidateCount,
                })
              }}
            </p>
          </AlertDialogHeader><Alert v-if="error" variant="destructive">
            <AlertDescription>
              {{ t(`panel.maintenance.${error}`) }}
            </AlertDescription>
          </Alert><AlertDialogFooter>
            <AlertDialogCancel :disabled="busy">
              {{ t("panel.common.cancel") }}
            </AlertDialogCancel><LoadingButton
              type="button"
              variant="destructive"
              :loading="busy"
              :disabled="stale"
              @click="persist"
            >
              {{
                t(
                  reverting
                    ? "panel.maintenance.useCommon"
                    : common
                      ? "panel.maintenance.saveDefault"
                      : "panel.maintenance.confirmEnable",
                )
              }}
            </LoadingButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
    <div v-if="suppressions.length" class="grid gap-2 text-[13px]">
      <h4 class="font-medium">
        {{ t("panel.maintenance.suppressions") }}
      </h4>
      <p class="text-muted-foreground">
        {{ t("panel.maintenance.suppressionHint") }}
      </p>
      <div
        v-for="episode in suppressions"
        :key="`${episode.season}:${episode.episode}`"
        class="flex flex-wrap items-center justify-between gap-2"
      >
        <span>S{{ episode.season }} E{{ episode.episode }}</span><Button
          size="sm"
          variant="outline"
          :disabled="busy || episode.status === 'pending'"
          @click="unsuppress(episode)"
        >
          {{
            t(
              episode.status === "pending"
                ? "panel.maintenance.pending"
                : "panel.maintenance.redownload",
            )
          }}
        </Button>
      </div>
    </div>
  </section>
</template>
