<script setup lang="ts">
import type { NetRoute } from '@torsher/api-client'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EllipsisIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import SettingsCard from './SettingsCard.vue'

const emit = defineEmits<{
  add: []
  edit: [route: NetRoute]
  delete: [route: NetRoute]
}>()

const { t } = useI18n()
const network = useNetwork()
const text = useNetworkText()

const movable = computed(() =>
  network.routes.value.filter(item => !item.isDefault),
)
const moving = ref<string | null>(null)

async function move(route: NetRoute, offset: -1 | 1) {
  moving.value = route.id

  try {
    await network.moveRoute(route.id, offset)
  }
  finally {
    moving.value = null
  }
}
</script>

<template>
  <SettingsCard
    :title="t('panel.settings.network.routes.title')"
    :description="t('panel.settings.network.routes.text')"
  >
    <ul class="divide-y rounded-lg border">
      <li
        v-for="route in network.routes.value"
        :key="route.id"
        class="group/row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2 pr-2 pl-3 text-[13.5px] sm:min-h-11"
      >
        <span
          class="grid min-w-0 gap-0.5 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)] sm:items-center sm:gap-3"
        >
          <span
            class="truncate font-medium"
            :class="route.isDefault ? 'text-[13.5px]' : 'font-mono text-[13px]'"
          >
            {{
              route.isDefault
                ? t("panel.settings.network.routes.default")
                : route.match
            }}
          </span>
          <span class="truncate text-[13px] text-muted-foreground">
            {{ text.routeText(route) }}
            <template v-if="route.hasUsername || route.hasPassword">
              · {{ t("panel.settings.network.routes.withCredentials") }}
            </template>
          </span>
        </span>
        <span class="flex items-center gap-0.5">
          <template v-if="!route.isDefault">
            <Button
              variant="ghost"
              size="icon-sm"
              class="size-7"
              :disabled="moving !== null || movable[0]?.id === route.id"
              :aria-label="
                t('panel.settings.network.routes.moveUp', {
                  match: route.match,
                })
              "
              @click="move(route, -1)"
            >
              <ArrowUpIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              class="size-7"
              :disabled="moving !== null || movable.at(-1)?.id === route.id"
              :aria-label="
                t('panel.settings.network.routes.moveDown', {
                  match: route.match,
                })
              "
              @click="move(route, 1)"
            >
              <ArrowDownIcon />
            </Button>
          </template>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                variant="ghost"
                size="icon-sm"
                class="size-7"
                :aria-label="
                  t('panel.settings.network.routes.actions', {
                    match: route.isDefault
                      ? t('panel.settings.network.routes.default')
                      : route.match,
                  })
                "
              >
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-auto min-w-44">
              <DropdownMenuItem @select="emit('edit', route)">
                <PencilIcon aria-hidden="true" />
                {{ t("panel.settings.network.routes.edit") }}
              </DropdownMenuItem>
              <template v-if="!route.isDefault">
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  @select="emit('delete', route)"
                >
                  <Trash2Icon aria-hidden="true" />
                  {{ t("panel.common.delete") }}
                </DropdownMenuItem>
              </template>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </li>
    </ul>
    <template #hint>
      {{ t("panel.settings.network.routes.hint") }}
    </template>
    <template #action>
      <Button size="sm" @click="emit('add')">
        <PlusIcon aria-hidden="true" />
        {{ t("panel.settings.network.routes.add") }}
      </Button>
    </template>
  </SettingsCard>
</template>
