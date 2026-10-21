<script setup lang="ts">
import type { NetHost } from '@torsher/api-client'
import { EllipsisIcon, RefreshCwIcon, RouteIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { toneText } from '~/lib/indexerStatus'
import { hostStatusView } from '~/lib/netStatus'

const props = defineProps<{
  host: NetHost
  /** Адрес прокси маршрута: в ответе проверки его нет */
  proxy: string | null
}>()

const emit = defineEmits<{
  check: []
  route: []
}>()

const { t } = useI18n()
const text = useNetworkText()

const view = computed(() => hostStatusView(props.host))
const label = computed(() => text.statusLabel(view.value))
const reason = computed(() => text.reason(props.host, view.value))
const route = computed(() =>
  text.routeText({ ...props.host.route, proxy: props.proxy }),
)
// Маршрут по хосту уже есть — меню правит его, а не создаёт второй
const hasOwnRoute = computed(
  () => props.host.route.match === props.host.hostname,
)
</script>

<template>
  <li
    class="group/row grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b py-2.5 pr-2.5 pl-4 text-[13.5px] last:border-b-0 hover:bg-muted/50 sm:min-h-11 sm:grid-cols-[16px_minmax(0,190px)_minmax(0,1fr)_auto] sm:py-1.5"
  >
    <span
      :class="
        cn(
          'row-span-2 mt-0.5 grid size-4 place-items-center self-start sm:row-span-1 sm:mt-0 sm:self-center',
          toneText[view.tone],
        )
      "
      :title="label"
    >
      <component
        :is="view.icon"
        class="size-4"
        :class="{ 'animate-spin': view.state === 'checking' }"
        aria-hidden="true"
      />
      <span class="sr-only">{{ label }}</span>
    </span>
    <span class="col-start-2 row-start-1 grid min-w-0">
      <span class="truncate font-mono text-[13px] font-medium">{{
        host.host
      }}</span>
      <span class="truncate text-[12.5px] text-muted-foreground">{{
        host.label
      }}</span>
    </span>
    <span
      class="col-span-2 col-start-2 row-start-2 text-[13px] sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:truncate"
      :class="reason ? toneText[view.tone] : 'text-muted-foreground'"
      :title="reason || route"
    >
      {{ reason || route }}
    </span>
    <span
      class="col-start-3 row-start-1 flex items-center justify-end gap-1 text-[12.5px] whitespace-nowrap text-muted-foreground tabular-nums sm:col-start-4"
    >
      <template v-if="view.state === 'checking'">
        {{ t("panel.settings.network.status.checking") }}
      </template>
      <template v-else-if="host.latencyMs !== null">
        {{ t("panel.settings.network.hosts.latency", { ms: host.latencyMs }) }}
      </template>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="size-7 sm:opacity-50 sm:group-focus-within/row:opacity-100 sm:group-hover/row:opacity-100 sm:aria-expanded:opacity-100"
            :aria-label="
              t('panel.settings.network.hosts.actions', { host: host.host })
            "
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-auto min-w-56">
          <DropdownMenuItem :disabled="host.checking" @select="emit('check')">
            <RefreshCwIcon aria-hidden="true" />
            {{ t("panel.settings.network.hosts.check") }}
          </DropdownMenuItem>
          <DropdownMenuItem @select="emit('route')">
            <RouteIcon aria-hidden="true" />
            {{
              t(
                hasOwnRoute
                  ? "panel.settings.network.hosts.editRoute"
                  : "panel.settings.network.hosts.createRoute",
              )
            }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  </li>
</template>
