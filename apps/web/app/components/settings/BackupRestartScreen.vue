<script setup lang="ts">
import { Loader2Icon, TriangleAlertIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import CommandLine from '~/components/CommandLine.vue'

const { t } = useI18n()
const { phase } = useRestoreFlow()

const visible = computed(
  () => phase.value === 'restarting' || phase.value === 'stuck',
)
</script>

<template>
  <!-- Поверх всего: панель без сервера всё равно не работает, а клики по ней только запутают -->
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-background px-4 py-8"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="backup-restart-title"
      aria-live="polite"
    >
      <div class="grid w-full max-w-md justify-items-center gap-3 text-center">
        <div
          class="grid size-11 place-items-center rounded-xl border bg-muted"
          aria-hidden="true"
        >
          <TriangleAlertIcon
            v-if="phase === 'stuck'"
            class="size-5 text-warning"
          />
          <Loader2Icon
            v-else
            class="size-5 animate-spin text-muted-foreground"
          />
        </div>
        <h2
          id="backup-restart-title"
          class="text-lg font-semibold tracking-tight"
        >
          {{
            phase === "stuck"
              ? t("panel.backups.restart.stuckTitle")
              : t("panel.backups.restart.title")
          }}
        </h2>
        <p class="text-muted-foreground">
          {{
            phase === "stuck"
              ? t("panel.backups.restart.stuckText")
              : t("panel.backups.restart.text")
          }}
        </p>
        <CommandLine
          v-if="phase === 'stuck'"
          class="w-full text-left"
          command="docker compose up -d"
        />
      </div>
    </div>
  </Teleport>
</template>
