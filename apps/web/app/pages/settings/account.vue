<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import PasswordCard from '~/components/settings/PasswordCard.vue'
import UsernameCard from '~/components/settings/UsernameCard.vue'

definePageMeta({
  middleware: 'required-auth',
})

const { t } = useI18n()
</script>

<template>
  <div class="grid gap-5">
    <header>
      <h1 class="text-[22px] font-semibold tracking-tight">
        {{ t("panel.settings.nav.account") }}
      </h1>
      <p class="mt-1 text-muted-foreground">
        {{ t("panel.settings.account.description") }}
      </p>
    </header>

    <UsernameCard />
    <PasswordCard />
  </div>
</template>
