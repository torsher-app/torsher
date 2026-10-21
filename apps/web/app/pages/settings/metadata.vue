<script setup lang="ts">
import { CircleAlertIcon, RefreshCwIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import MetadataKeyCard from '~/components/settings/MetadataKeyCard.vue'

definePageMeta({
  middleware: 'required-auth',
})

const { t } = useI18n()
const { settings, state, load } = useMetadataSettings()

onMounted(load)
</script>

<template>
  <div class="grid gap-5">
    <header>
      <h1 class="text-[22px] font-semibold tracking-tight">
        {{ t("panel.settings.nav.metadata") }}
      </h1>
      <p class="mt-1 text-muted-foreground">
        {{ t("panel.settings.metadata.description") }}
      </p>
    </header>

    <Skeleton
      v-if="state === 'loading' || state === 'idle'"
      class="h-56 rounded-xl"
      aria-busy="true"
    />

    <section
      v-else-if="state === 'error' || !settings"
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
        {{ t("panel.settings.metadata.loadError") }}
      </h2>
      <p class="text-muted-foreground">
        {{ t("panel.settings.network.loadErrorText") }}
      </p>
      <Button variant="outline" @click="load">
        <RefreshCwIcon aria-hidden="true" />
        {{ t("panel.common.retry") }}
      </Button>
    </section>

    <MetadataKeyCard v-else :settings="settings" />
  </div>
</template>
