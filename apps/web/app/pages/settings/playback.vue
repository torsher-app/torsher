<script setup lang="ts">
import { CircleAlertIcon, RefreshCwIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import AccelCard from '~/components/settings/AccelCard.vue'
import TranscodeCard from '~/components/settings/TranscodeCard.vue'

definePageMeta({
  middleware: 'required-auth',
})

const { t } = useI18n()
const { settings, state, load } = usePlaybackSettings()
const loading = useHeldLoading(
  () => state.value === 'loading' || state.value === 'idle',
)

onMounted(load)
</script>

<template>
  <div class="grid gap-5">
    <header>
      <h1 class="text-[22px] font-semibold tracking-tight">
        {{ t("panel.settings.nav.playback") }}
      </h1>
      <p class="mt-1 text-muted-foreground">
        {{ t("panel.settings.playback.description") }}
      </p>
    </header>

    <!-- Скелетоны в размер обеих карточек: ничего не прыгает после загрузки -->
    <div v-if="loading" class="grid gap-5" aria-busy="true">
      <Skeleton class="h-68 rounded-xl" />
      <Skeleton class="h-77 rounded-xl" />
    </div>

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
        {{ t("panel.settings.playback.loadError") }}
      </h2>
      <p class="text-muted-foreground">
        {{ t("panel.settings.network.loadErrorText") }}
      </p>
      <Button variant="outline" @click="load">
        <RefreshCwIcon aria-hidden="true" />
        {{ t("panel.common.retry") }}
      </Button>
    </section>

    <template v-else>
      <AccelCard :settings="settings" />
      <TranscodeCard :settings="settings" />
    </template>
  </div>
</template>
