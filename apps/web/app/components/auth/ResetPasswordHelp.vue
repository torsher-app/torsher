<script setup lang="ts">
import { KeyRoundIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import CommandLine from '~/components/CommandLine.vue'

// Имя контейнера — из примера установки (docker-compose.example.yml)
const COMMAND = 'docker exec -it torsher torsher reset-password'

const { t } = useI18n()
</script>

<template>
  <!-- Писем нет: пароль единственного аккаунта сбрасывает команда на сервере -->
  <Alert variant="info">
    <KeyRoundIcon />
    <AlertTitle>{{ t("panel.auth.forgotTitle") }}</AlertTitle>
    <AlertDescription class="grid gap-2.5">
      <p>{{ t("panel.auth.forgotText") }}</p>
      <CommandLine :command="COMMAND" />
      <p>{{ t("panel.auth.forgotHint") }}</p>
    </AlertDescription>
  </Alert>
</template>
