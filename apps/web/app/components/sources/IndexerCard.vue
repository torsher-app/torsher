<script setup lang="ts">
import type { Indexer, IndexerManager } from '@torsher/api-client'
import {
  CircleXIcon,
  ExternalLinkIcon,
  PencilIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  XIcon,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import LoadingButton from '~/components/LoadingButton.vue'
import { formatDateTime, formatRelative } from '~/lib/format'
import IndexerStatusIcon from './IndexerStatusIcon.vue'

const props = defineProps<{
  indexer: Indexer | null
  manager?: IndexerManager
  now: number
}>()

const emit = defineEmits<{
  close: []
  edit: []
  delete: []
}>()

const { t, locale } = useI18n()
const status = useIndexerStatus()
const actions = useIndexerActions()
const { isChecking } = useSources()

const isToggling = ref(false)
// Пока лист уезжает, в нём остаётся последний индексатор, а не пустота
const shown = shallowRef<Indexer | null>(props.indexer)

watch(
  () => props.indexer,
  (indexer) => {
    if (indexer)
      shown.value = indexer
  },
)

const view = computed(() => (shown.value ? status.viewOf(shown.value) : null))
const label = computed(() =>
  shown.value && view.value ? status.label(shown.value, view.value) : '',
)
const problem = computed(() =>
  shown.value && view.value ? status.problem(shown.value, view.value) : '',
)
const managerName = computed(() =>
  shown.value ? status.managerName(shown.value) : '',
)
const modes = computed(() => {
  const searchModes = shown.value?.searchModes

  if (!searchModes)
    return ''

  return (['movieSearch', 'tvSearch', 'search'] as const)
    .filter(mode => searchModes[mode])
    .map(mode => t(`panel.sources.card.modes.${mode}`))
    .join(', ')
})

async function onToggle(enabled: boolean) {
  if (!shown.value)
    return

  isToggling.value = true

  try {
    await actions.toggle(shown.value, enabled)
  }
  finally {
    isToggling.value = false
  }
}

// Список под карточкой остаётся живым: клик по другой строке переключает карточку
function onInteractOutside(event: Event) {
  const target = event.target as HTMLElement | null

  if (target?.closest('[data-sources-list]'))
    event.preventDefault()
}
</script>

<template>
  <Sheet
    :open="!!indexer"
    :modal="false"
    @update:open="(isOpen) => !isOpen && emit('close')"
  >
    <SheetContent
      side="right"
      :show-close-button="false"
      class="gap-0 bg-background p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[440px] md:data-[side=right]:inset-y-2 md:data-[side=right]:right-2 md:data-[side=right]:h-auto md:rounded-r-xl md:border"
      @interact-outside="onInteractOutside"
    >
      <template v-if="shown && view">
        <header
          class="flex h-12 shrink-0 items-center gap-2 border-b pr-2 pl-4"
        >
          <IndexerStatusIcon :view="view" :label="label" />
          <SheetTitle class="min-w-0 flex-1 truncate text-[15px] font-semibold">
            {{ shown.name }}
          </SheetTitle>
          <SheetDescription class="sr-only">
            {{ label }}
          </SheetDescription>
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="t('panel.common.close')"
            @click="emit('close')"
          >
            <XIcon />
          </Button>
        </header>

        <div
          class="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto p-4"
        >
          <Alert
            v-if="problem"
            :variant="view.tone === 'destructive' ? 'destructive' : 'warning'"
          >
            <CircleXIcon v-if="view.tone === 'destructive'" />
            <TriangleAlertIcon v-else />
            <AlertTitle>{{ label }}</AlertTitle>
            <AlertDescription>{{ problem }}</AlertDescription>
          </Alert>

          <dl
            class="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-[13.5px]"
          >
            <dt class="text-muted-foreground">
              <label for="indexer-card-enabled">{{
                t("panel.sources.card.search")
              }}</label>
            </dt>
            <dd>
              <Switch
                id="indexer-card-enabled"
                :model-value="shown.enabled"
                :disabled="isToggling"
                @update:model-value="onToggle"
              />
            </dd>
            <dt class="text-muted-foreground">
              {{ t("panel.sources.card.status") }}
            </dt>
            <dd class="flex flex-wrap items-center gap-2">
              <Badge :variant="view.badge">
                {{ label }}
              </Badge>
              <span
                v-if="shown.checkedAt && view.state !== 'checking'"
                class="text-muted-foreground"
                :title="formatDateTime(shown.checkedAt, locale)"
              >
                {{ formatRelative(shown.checkedAt, locale, now) }}
              </span>
            </dd>
            <dt class="text-muted-foreground">
              {{ t("panel.sources.card.url") }}
            </dt>
            <dd class="font-mono text-xs break-all">
              {{ shown.url }}
            </dd>
            <dt class="text-muted-foreground">
              {{ t("panel.sources.card.source") }}
            </dt>
            <dd>
              {{
                managerName
                  ? t("panel.sources.card.fromManager", {
                    manager: managerName,
                  })
                  : t("panel.sources.indexers.manual")
              }}
            </dd>
            <template v-if="modes">
              <dt class="text-muted-foreground">
                {{ t("panel.sources.card.modes.label") }}
              </dt>
              <dd>{{ modes }}</dd>
            </template>
            <dt class="self-start text-muted-foreground">
              {{ t("panel.sources.card.categories") }}
            </dt>
            <dd>
              {{ status.categories(shown) || t("panel.sources.card.none") }}
            </dd>
          </dl>
        </div>

        <footer class="flex shrink-0 flex-wrap gap-2 border-t p-3">
          <LoadingButton
            variant="outline"
            size="sm"
            :loading="isChecking(shown.id)"
            @click="actions.test(shown)"
          >
            <RefreshCwIcon aria-hidden="true" />
            {{ t("panel.sources.indexers.test") }}
          </LoadingButton>
          <Button v-if="manager" variant="ghost" size="sm" as-child>
            <a :href="manager.url" target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon aria-hidden="true" />
              {{ t("panel.sources.managers.open", { manager: managerName }) }}
            </a>
          </Button>
          <Button
            v-else-if="!shown.managerId"
            variant="ghost"
            size="sm"
            @click="emit('edit')"
          >
            <PencilIcon aria-hidden="true" />
            {{ t("panel.sources.indexers.edit") }}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            class="ml-auto"
            @click="emit('delete')"
          >
            {{ t("panel.common.delete") }}
          </Button>
        </footer>
      </template>
    </SheetContent>
  </Sheet>
</template>
