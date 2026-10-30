<script setup lang="ts">
import { CircleAlertIcon, RefreshCwIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import FollowAudioCard from '~/components/settings/FollowAudioCard.vue'
import FollowDefaultsCard from '~/components/settings/FollowDefaultsCard.vue'
import FollowNumberCard from '~/components/settings/FollowNumberCard.vue'

definePageMeta({
  middleware: 'required-auth',
})

const { t } = useI18n()
const { settings, state, load } = useFollowSettings()
const loading = useHeldLoading(
  () => state.value === 'loading' || state.value === 'idle',
)

onMounted(load)
</script>

<template>
  <div class="grid gap-5">
    <header>
      <h1 class="text-[22px] font-semibold tracking-tight">
        {{ t("panel.settings.nav.follow") }}
      </h1>
      <p class="mt-1 text-muted-foreground">
        {{ t("panel.settings.follow.description") }}
      </p>
    </header>

    <!-- Скелетоны в размер карточек: ничего не прыгает после загрузки -->
    <div v-if="loading" class="grid gap-5" aria-busy="true">
      <Skeleton class="h-50 rounded-xl" />
      <Skeleton class="h-50 rounded-xl" />
      <Skeleton class="h-50 rounded-xl" />
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
        {{ t("panel.settings.follow.loadError") }}
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
      <FollowAudioCard :audio="settings.audio" />
      <FollowNumberCard
        field="rssIntervalMin"
        :value="settings.rssIntervalMin"
        :title="t('panel.settings.follow.rss.title')"
        :description="t('panel.settings.follow.rss.description')"
        :unit="t('panel.settings.follow.rss.unit')"
        :min="10"
        :max="120"
        allow-zero
        :error="t('panel.settings.follow.rss.error')"
      >
        <template #hint>
          {{
            settings.rssIntervalMin
              ? t("panel.settings.follow.rss.hint")
              : t("panel.settings.follow.rss.off")
          }}
        </template>
      </FollowNumberCard>
      <FollowNumberCard
        field="searchesPerHour"
        :value="settings.searchesPerHour"
        :title="t('panel.settings.follow.budget.title')"
        :description="t('panel.settings.follow.budget.description')"
        :unit="t('panel.settings.follow.budget.unit')"
        :min="1"
        :max="60"
        :error="t('panel.settings.follow.budget.error')"
      >
        <template #hint>
          {{ t("panel.settings.follow.budget.hint") }}
        </template>
      </FollowNumberCard>
      <FollowDefaultsCard :defaults="settings.defaults" />
    </template>
  </div>
</template>
