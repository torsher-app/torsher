<script setup lang="ts">
import { useI18n } from 'vue-i18n'
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
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import LoadingButton from '~/components/LoadingButton.vue'
import MaintenanceRules from '~/components/maintenance/MaintenanceRules.vue'
import MaintenanceOperations from '~/components/maintenance/MaintenanceOperations.vue'
import { formatDateTime } from '~/lib/format'
import SettingsCard from './SettingsCard.vue'

const { t, locale } = useI18n()
const {
  status,
  busy,
  error,
  detail,
  load,
  toggle,
  retry,
  acknowledge,
  cancelFence,
} = useMaintenanceExecution()
const confirming = ref(false)
const reviewed = ref(false)
const loading = useHeldLoading(() => busy.value && !status.value)
async function enable() {
  if (await toggle(true))
    confirming.value = false
}
function requestToggle(enabled: boolean) {
  if (enabled)
    confirming.value = true
  else void toggle(false)
}
</script>

<template>
  <SettingsCard
    id="auto-delete"
    :title="t('panel.maintenance.title')"
    :description="t('panel.maintenance.executionDescription')"
  >
    <Alert v-if="error" variant="destructive">
      <AlertDescription>
        {{ t(`panel.maintenance.${error}`) }}
        <details v-if="detail">
          <summary>{{ t("panel.maintenance.details") }}</summary>
          <p class="break-all">
            {{ detail }}
          </p>
        </details>
      </AlertDescription>
    </Alert>
    <Skeleton v-if="loading" class="h-40" />
    <template v-else-if="status">
      <div class="flex items-center justify-between gap-3">
        <Label for="maintenance-execution">{{
          t("panel.maintenance.execution")
        }}</Label><Switch
          id="maintenance-execution"
          :model-value="status.executorEnabled"
          :disabled="
            !status.executorEnabled
              && (busy || !status.executorAvailable || status.restoreHold)
          "
          @update:model-value="requestToggle"
        />
      </div>
      <p v-if="!status.executorAvailable" class="text-sm text-muted-foreground">
        {{ t("panel.maintenance.unavailable") }}
      </p>
      <p class="text-sm text-muted-foreground">
        {{
          t("panel.maintenance.counts", {
            rules: status.rulesEnabled,
            groups: status.groups,
            operations: status.operations.filter((op) => op.action !== "none")
              .length,
          })
        }}
      </p>
      <p v-if="status.nextRunAt" class="text-sm text-muted-foreground">
        {{
          t("panel.maintenance.nextRun", {
            date: formatDateTime(status.nextRunAt, locale),
          })
        }}
      </p>
      <AlertDialog v-model:open="confirming">
        <AlertDialogContent :class="dialogSheetClass">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {{ t("panel.maintenance.confirmEnable") }}
            </AlertDialogTitle><AlertDialogDescription>
              {{ t("panel.maintenance.confirmExecution") }}
            </AlertDialogDescription>
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
              :disabled="false"
              @click="enable"
            >
              {{ t("panel.maintenance.confirmEnable") }}
            </LoadingButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Alert v-if="status.restoreHold" variant="warning">
        <AlertDescription>
          <p>{{ t("panel.maintenance.restoreHold") }}</p>
          <p v-if="status.lostCleanupHistory" class="mt-2">
            {{ t("panel.maintenance.lostHistory") }}
          </p>
          <Label class="mt-3 flex items-start gap-2"><Checkbox v-model="reviewed" :disabled="busy" />{{
            t("panel.maintenance.reviewed")
          }}</Label><LoadingButton
            class="mt-3"
            variant="outline"
            :loading="busy"
            :disabled="!reviewed"
            @click="acknowledge"
          >
            {{ t("panel.maintenance.acknowledge") }}
          </LoadingButton>
        </AlertDescription>
      </Alert>
      <Alert v-else-if="status.lostCleanupHistory" variant="warning">
        <AlertDescription>
          {{ t("panel.maintenance.lostHistory") }}
        </AlertDescription>
      </Alert>
      <MaintenanceRules :status="status" @saved="load" />
      <MaintenanceOperations
        :status="status"
        :busy="busy"
        @retry="retry"
        @cancel-fence="cancelFence"
      />
    </template>
    <template #action>
      <Button variant="outline" size="sm" :disabled="busy" @click="load">
        {{ t("panel.maintenance.refresh") }}
      </Button>
    </template>
  </SettingsCard>
</template>
