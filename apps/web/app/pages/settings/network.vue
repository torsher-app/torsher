<script setup lang="ts">
import type { NetHost, NetRoute } from '@torsher/api-client'
import { CircleAlertIcon, RefreshCwIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import DeleteRouteDialog from '~/components/settings/DeleteRouteDialog.vue'
import NetworkDnsCard from '~/components/settings/NetworkDnsCard.vue'
import NetworkHosts from '~/components/settings/NetworkHosts.vue'
import NetworkRouteDialog from '~/components/settings/NetworkRouteDialog.vue'
import NetworkRoutesCard from '~/components/settings/NetworkRoutesCard.vue'

definePageMeta({
  middleware: 'required-auth',
})

const { t } = useI18n()
const network = useNetwork()
const loading = useHeldLoading(
  () => network.state.value === 'loading' || network.state.value === 'idle',
)

const dialogOpen = ref(false)
const editing = ref<NetRoute | null>(null)
const presetMatch = ref<string>()
const deleteOpen = ref(false)
const deleting = ref<NetRoute | null>(null)

function openAdd(match?: string) {
  editing.value = null
  presetMatch.value = match
  dialogOpen.value = true
}

function openEdit(route: NetRoute) {
  editing.value = route
  presetMatch.value = undefined
  dialogOpen.value = true
}

/** Из строки хоста: свой маршрут хоста правим, иначе создаём маршрут на его имя */
function routeForHost(host: NetHost) {
  const own = network.routes.value.find(item => item.match === host.hostname)

  if (own)
    openEdit(own)
  else openAdd(host.hostname)
}

function openDelete(route: NetRoute) {
  deleting.value = route
  deleteOpen.value = true
}

onMounted(network.load)
onBeforeUnmount(network.stopPolling)
</script>

<template>
  <div class="grid gap-5">
    <header>
      <h1 class="text-[22px] font-semibold tracking-tight">
        {{ t("panel.settings.nav.network") }}
      </h1>
      <p class="mt-1 text-muted-foreground">
        {{ t("panel.settings.network.description") }}
      </p>
    </header>

    <!-- Скелетон повторяет список хостов и карточки настроек -->
    <div v-if="loading" class="grid gap-5" aria-busy="true">
      <div class="grid gap-0 overflow-hidden rounded-xl border">
        <Skeleton class="m-5 h-10 w-2/3" />
        <div
          v-for="index in 3"
          :key="index"
          class="flex h-11 items-center gap-3 border-t px-4"
        >
          <Skeleton class="size-4 rounded-full" />
          <Skeleton class="h-3.5 w-40" />
          <Skeleton class="ml-auto h-3.5 w-12" />
        </div>
      </div>
      <Skeleton class="h-40 rounded-xl" />
      <Skeleton class="h-48 rounded-xl" />
    </div>

    <section
      v-else-if="network.state.value === 'error'"
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
        {{ t("panel.settings.network.loadError") }}
      </h2>
      <p class="text-muted-foreground">
        {{ t("panel.settings.network.loadErrorText") }}
      </p>
      <Button variant="outline" @click="network.load">
        <RefreshCwIcon aria-hidden="true" />
        {{ t("panel.common.retry") }}
      </Button>
    </section>

    <template v-else>
      <NetworkHosts @route="routeForHost" />
      <NetworkDnsCard
        v-if="network.defaultRoute.value"
        :route="network.defaultRoute.value"
      />
      <NetworkRoutesCard
        @add="openAdd()"
        @edit="openEdit"
        @delete="openDelete"
      />
    </template>

    <NetworkRouteDialog
      v-model:open="dialogOpen"
      :route="editing"
      :preset-match="presetMatch"
    />
    <DeleteRouteDialog v-model:open="deleteOpen" :route="deleting" />
  </div>
</template>
