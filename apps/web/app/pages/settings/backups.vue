<script setup lang="ts">
import type { RestoreOutcome } from '~/composables/useRestoreFlow'
import { CircleAlertIcon, RefreshCwIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import BackupDirCard from '~/components/settings/BackupDirCard.vue'
import BackupEncryptionCard from '~/components/settings/BackupEncryptionCard.vue'
import BackupList from '~/components/settings/BackupList.vue'
import BackupRestartScreen from '~/components/settings/BackupRestartScreen.vue'
import BackupRestoreResult from '~/components/settings/BackupRestoreResult.vue'
import BackupScheduleCard from '~/components/settings/BackupScheduleCard.vue'
import TransferCard from '~/components/settings/TransferCard.vue'
import { backupErrorText } from '~/lib/backups'

definePageMeta({
  middleware: 'required-auth',
})

const { t, locale } = useI18n()
const { status, state, load } = useBackups()
const { clearSession } = useAuth()

useBackupsPolling()

const result = computed(() => {
  const restore = status.value?.restore

  return restore?.state === 'done' || restore?.state === 'failed'
    ? restore
    : null
})

/**
 * Сервер поднялся после восстановления: свежие данные страницы и итог
 * тостом один раз. Сессия из чужой базы не подошла — вход паролем копии.
 */
async function onRestored(
  outcome: Extract<RestoreOutcome, { kind: 'finished' }>,
) {
  if (outcome.signedOut) {
    toast.success(t('panel.backups.setup.done'), {
      description: t('panel.backups.setup.doneText'),
    })
    await clearSession()
    return
  }

  await load()

  const restore = outcome.restore

  if (restore?.state === 'failed') {
    toast.error(t('panel.backups.result.failed'), {
      description: backupErrorText(t, locale.value, {
        kind: restore.reason ?? 'unknown',
        params: restore.params,
      }),
    })
  }
  else {
    toast.success(t('panel.backups.result.doneShort'))
  }
}
</script>

<template>
  <div class="grid gap-5">
    <header>
      <h1 class="text-[22px] font-semibold tracking-tight">
        {{ t("panel.settings.nav.backups") }}
      </h1>
      <p class="mt-1 max-w-[70ch] text-muted-foreground">
        {{ t("panel.backups.description") }}
      </p>
    </header>

    <!-- Скелетон повторяет карточки и строки списка копий -->
    <div
      v-if="state === 'loading' || state === 'idle'"
      class="grid gap-5"
      aria-busy="true"
    >
      <Skeleton class="h-72 rounded-xl" />
      <Skeleton class="h-40 rounded-xl" />
      <Skeleton class="h-64 rounded-xl" />
      <div class="grid overflow-hidden rounded-xl border">
        <div class="grid gap-2 p-5">
          <Skeleton class="h-5 w-24 rounded" />
          <Skeleton class="h-4 w-64 max-w-full rounded" />
        </div>
        <div
          v-for="row in 4"
          :key="row"
          class="flex h-11 items-center gap-3 border-t px-4"
        >
          <Skeleton class="size-4 rounded" />
          <Skeleton class="h-4 w-40 rounded" />
          <Skeleton class="ml-auto h-4 w-14 rounded" />
        </div>
      </div>
    </div>

    <section
      v-else-if="state === 'error' || !status"
      class="grid justify-items-center gap-3.5 rounded-xl border px-4 py-10 text-center"
      role="alert"
    >
      <div
        class="grid size-11 place-items-center rounded-xl border bg-muted text-destructive"
        aria-hidden="true"
      >
        <CircleAlertIcon class="size-5" />
      </div>
      <h2 class="text-base font-semibold">
        {{ t("panel.backups.loadError") }}
      </h2>
      <p class="text-muted-foreground">
        {{ t("panel.backups.loadErrorText") }}
      </p>
      <Button variant="outline" @click="load">
        <RefreshCwIcon aria-hidden="true" />
        {{ t("panel.common.retry") }}
      </Button>
    </section>

    <template v-else>
      <BackupRestoreResult v-if="result" :restore="result" />

      <BackupScheduleCard :status="status" />

      <BackupDirCard :status="status" />

      <BackupEncryptionCard :status="status" />

      <BackupList :status="status" @restored="onRestored" />

      <TransferCard @restored="onRestored" />
    </template>

    <BackupRestartScreen />
  </div>
</template>
