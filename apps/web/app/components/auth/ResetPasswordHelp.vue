<script setup lang="ts">
import { CopyIcon, KeyRoundIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { copyText } from '~/lib/clipboard'

// Имя контейнера — из примера установки (docker-compose.example.yml)
const COMMAND = 'docker exec -it torsher torsher reset-password'

const { t } = useI18n()

async function copy() {
  try {
    await copyText(COMMAND)
    toast.success(t('panel.auth.commandCopied'))
  }
  catch {
    toast.error(t('panel.auth.copyFailed'))
  }
}
</script>

<template>
  <!-- Писем нет: пароль единственного аккаунта сбрасывает команда на сервере -->
  <Alert variant="info">
    <KeyRoundIcon />
    <AlertTitle>{{ t("panel.auth.forgotTitle") }}</AlertTitle>
    <AlertDescription class="grid gap-2.5">
      <p>{{ t("panel.auth.forgotText") }}</p>
      <div
        class="flex items-center gap-1 rounded-md border bg-background py-1 pr-1 pl-2.5 text-foreground"
      >
        <code class="min-w-0 flex-1 font-mono text-[12.5px] break-all">{{
          COMMAND
        }}</code>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          class="shrink-0 text-muted-foreground"
          :aria-label="t('panel.auth.copyCommand')"
          @click="copy"
        >
          <CopyIcon />
        </Button>
      </div>
      <p>{{ t("panel.auth.forgotHint") }}</p>
    </AlertDescription>
  </Alert>
</template>
