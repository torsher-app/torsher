<script setup lang="ts">
import type { SubtitleSettings } from '@torsher/api-client'
import { getErrorStatus } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { api } from '~/services/api'
import SubtitleProviderCard from './SubtitleProviderCard.vue'

const { t } = useI18n()
const base = 'panel.settings.playback.subtitles'
const settings = shallowRef<SubtitleSettings>()
const failed = ref(false)

async function load() {
  failed.value = false
  try {
    settings.value = await withErrorMode('silent', () =>
      api.settings.getSubtitleSettings())
  }
  catch (error) {
    failed.value = getErrorStatus(error) !== 404
  }
}

onMounted(load)
</script>

<template>
  <section
    v-if="settings || failed"
    class="grid gap-3"
    aria-labelledby="subtitle-providers-title"
  >
    <header>
      <h2 id="subtitle-providers-title" class="text-base font-semibold">
        {{ t(`${base}.title`) }}
      </h2>
      <p class="max-w-[72ch] text-sm text-muted-foreground">
        {{ t(`${base}.description`) }}
      </p>
    </header>
    <template v-if="settings">
      <SubtitleProviderCard
        kind="opensubtitles"
        :settings="settings"
        @saved="settings = $event"
      />
      <SubtitleProviderCard
        kind="subdl"
        :settings="settings"
        @saved="settings = $event"
      />
    </template>
    <div
      v-else
      class="flex items-center justify-between gap-3 rounded-xl border p-4"
      role="alert"
    >
      <p class="text-sm text-destructive">
        {{ t("panel.settings.playback.loadError") }}
      </p>
      <Button variant="outline" @click="load">
        {{ t("panel.common.retry") }}
      </Button>
    </div>
  </section>
</template>
