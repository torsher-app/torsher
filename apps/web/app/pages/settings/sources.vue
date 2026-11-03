<script setup lang="ts">
import { CircleAlertIcon, RefreshCwIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import SourcePresetManager from '~/components/settings/SourcePresetManager.vue'

definePageMeta({
  middleware: 'required-auth',
})

const { t } = useI18n()
const { settings, state, load } = useSourceSettings()
const loading = useHeldLoading(
  () => state.value === 'loading' || state.value === 'idle',
)

const selectedId = ref('')
const preset = computed(
  () =>
    settings.value?.presets.find(item => item.id === selectedId.value)
    ?? settings.value?.presets.find(
      item => item.id === settings.value?.defaultPresetId,
    ),
)
onMounted(load)
</script>

<template>
  <div class="grid gap-5">
    <header>
      <h1 class="text-[22px] font-semibold tracking-tight">
        {{ t("panel.settings.nav.sources") }}
      </h1>
      <p class="mt-1 text-muted-foreground">
        {{ t("panel.settings.sources.description") }}
      </p>
    </header>

    <!-- Скелетоны в размер карточек: ничего не прыгает после загрузки -->
    <div v-if="loading" class="grid gap-5" aria-busy="true">
      <Skeleton class="h-90 rounded-xl" />
      <Skeleton class="h-120 rounded-xl" />
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
        {{ t("panel.settings.sources.loadError") }}
      </h2>
      <p class="text-muted-foreground">
        {{ t("panel.settings.network.loadErrorText") }}
      </p>
      <Button variant="outline" @click="load">
        <RefreshCwIcon aria-hidden="true" />
        {{ t("panel.common.retry") }}
      </Button>
    </section>

    <template v-else-if="preset">
      <SourcePresetManager
        :key="preset.id"
        :settings="settings"
        :selected-id="preset.id"
        @select="selectedId = $event"
      />
    </template>
  </div>
</template>
