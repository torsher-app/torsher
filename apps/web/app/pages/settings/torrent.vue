<script setup lang="ts">
import { CircleAlertIcon, RefreshCwIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import TorrentConnectionsCard from '~/components/settings/TorrentConnectionsCard.vue'
import TorrentDiscoveryCard from '~/components/settings/TorrentDiscoveryCard.vue'
import TorrentEncryptionCard from '~/components/settings/TorrentEncryptionCard.vue'
import TorrentPortCard from '~/components/settings/TorrentPortCard.vue'
import TorrentQueueCard from '~/components/settings/TorrentQueueCard.vue'
import TorrentRestartAlert from '~/components/settings/TorrentRestartAlert.vue'
import TorrentSeedCacheCard from '~/components/settings/TorrentSeedCacheCard.vue'
import TorrentSeedRuleCard from '~/components/settings/TorrentSeedRuleCard.vue'
import TorrentSpeedCard from '~/components/settings/TorrentSpeedCard.vue'

definePageMeta({
  middleware: 'required-auth',
})

const { t } = useI18n()
const { settings, state, load } = useTorrentSettings()
const loading = useHeldLoading(
  () => state.value === 'loading' || state.value === 'idle',
)

onMounted(load)
</script>

<template>
  <div class="grid gap-5">
    <header>
      <h1 class="text-[22px] font-semibold tracking-tight">
        {{ t("panel.settings.nav.torrent") }}
      </h1>
      <p class="mt-1 text-muted-foreground">
        {{ t("panel.settings.torrent.description") }}
      </p>
    </header>

    <!-- Скелетоны в размер карточек: ничего не прыгает после загрузки -->
    <div v-if="loading" class="grid gap-5" aria-busy="true">
      <Skeleton class="h-48 rounded-xl" />
      <Skeleton class="h-48 rounded-xl" />
      <Skeleton class="h-52 rounded-xl" />
      <Skeleton class="h-64 rounded-xl" />
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
        {{ t("panel.settings.torrent.loadError") }}
      </h2>
      <p class="text-muted-foreground">
        {{ t("panel.settings.storage.loadErrorText") }}
      </p>
      <Button variant="outline" @click="load">
        <RefreshCwIcon aria-hidden="true" />
        {{ t("panel.common.retry") }}
      </Button>
    </section>

    <template v-else>
      <TorrentRestartAlert :settings="settings" />

      <TorrentSpeedCard
        field="downloadLimit"
        :value="settings.values.downloadLimit"
        :title="t('panel.settings.torrent.download.title')"
        :description="t('panel.settings.torrent.download.text')"
      >
        <template #hint>
          {{ t("panel.settings.torrent.download.hint") }}
        </template>
      </TorrentSpeedCard>

      <TorrentSpeedCard
        field="uploadLimit"
        :value="settings.values.uploadLimit"
        :title="t('panel.settings.torrent.upload.title')"
        :description="t('panel.settings.torrent.upload.text')"
      >
        <template #hint>
          {{ t("panel.settings.torrent.upload.hint") }}
        </template>
      </TorrentSpeedCard>

      <TorrentQueueCard
        :value="settings.values.activeDownloads"
        :default-value="settings.defaults.activeDownloads"
      />

      <TorrentSeedRuleCard
        :rule="settings.values.seedRule"
        :default-rule="settings.defaults.seedRule"
      />

      <TorrentSeedCacheCard :value="settings.values.seedCache" />

      <TorrentConnectionsCard
        :values="settings.values"
        :defaults="settings.defaults"
      />

      <TorrentPortCard :settings="settings" />

      <TorrentDiscoveryCard :values="settings.values" />

      <TorrentEncryptionCard
        :value="settings.values.encryption"
        :default-value="settings.defaults.encryption"
      />
    </template>
  </div>
</template>
