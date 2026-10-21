<script setup lang="ts">
import type { Indexer } from '@torsher/api-client'
import {
  CirclePauseIcon,
  CirclePlayIcon,
  CopyIcon,
  EllipsisIcon,
  RefreshCwIcon,
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
import { cn } from '@/lib/utils'
import { formatRelative, hostOf } from '~/lib/format'
import { toneText } from '~/lib/indexerStatus'
import IndexerStatusIcon from './IndexerStatusIcon.vue'

const props = defineProps<{
  indexer: Indexer
  selected: boolean
  now: number
}>()

const emit = defineEmits<{
  open: []
  delete: []
}>()

const { t, locale } = useI18n()
const status = useIndexerStatus()
const actions = useIndexerActions()

const view = computed(() => status.viewOf(props.indexer))
const label = computed(() => status.label(props.indexer, view.value))
const reason = computed(() => status.reason(props.indexer, view.value))
const middle = computed(() => {
  if (reason.value)
    return reason.value

  const categories = status.categories(props.indexer)

  return props.indexer.enabled
    ? categories
    : [label.value, categories].filter(Boolean).join(' · ')
})
const checkedAt = computed(() =>
  props.indexer.checkedAt && view.value.state !== 'checking'
    ? formatRelative(props.indexer.checkedAt, locale.value, props.now)
    : '',
)
</script>

<template>
  <!-- Строку открывает кнопка-имя, растянутая на всю строку: меню «⋯» лежит поверх неё -->
  <li
    :class="
      cn(
        'group/row relative grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b py-2.5 pr-2.5 pl-4 text-[13.5px] hover:bg-muted/50',
        'sm:h-11 sm:grid-cols-[16px_minmax(0,190px)_minmax(0,1fr)_116px] sm:py-0',
        'xl:grid-cols-[16px_190px_minmax(0,1fr)_210px_116px]',
        selected && 'bg-muted/50 shadow-[inset_2px_0_0_var(--primary)]',
      )
    "
  >
    <IndexerStatusIcon
      :view="view"
      :label="label"
      class="row-span-2 mt-0.5 self-start sm:row-span-1 sm:mt-0 sm:self-center"
    />
    <button
      type="button"
      class="col-start-2 row-start-1 min-w-0 truncate text-left font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
      :class="{ 'font-normal text-muted-foreground': !indexer.enabled }"
      :aria-current="selected || undefined"
      @click="emit('open')"
    >
      {{ indexer.name }}
    </button>
    <span
      class="col-span-2 col-start-2 row-start-2 truncate text-[13px] sm:col-span-1 sm:col-start-3 sm:row-start-1"
      :class="reason ? toneText[view.tone] : 'text-muted-foreground'"
    >
      {{ middle }}
    </span>
    <span
      class="hidden truncate font-mono text-xs text-muted-foreground/80 xl:col-start-4 xl:row-start-1 xl:block"
    >
      {{ hostOf(indexer.url) }}
    </span>
    <span
      class="col-start-3 row-start-1 flex items-center justify-end gap-1 text-[12.5px] whitespace-nowrap text-muted-foreground tabular-nums sm:col-start-4 xl:col-start-5"
    >
      {{ checkedAt }}
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="relative size-7 sm:opacity-50 sm:group-focus-within/row:opacity-100 sm:group-hover/row:opacity-100 sm:aria-expanded:opacity-100"
            :class="{ 'sm:opacity-100': selected }"
            :aria-label="
              t('panel.sources.indexers.actions', { name: indexer.name })
            "
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-auto min-w-52">
          <DropdownMenuItem @select="actions.test(indexer)">
            <RefreshCwIcon aria-hidden="true" />
            {{ t("panel.sources.indexers.test") }}
          </DropdownMenuItem>
          <DropdownMenuItem @select="actions.toggle(indexer)">
            <component
              :is="indexer.enabled ? CirclePauseIcon : CirclePlayIcon"
              aria-hidden="true"
            />
            {{
              t(
                indexer.enabled
                  ? "panel.sources.indexers.disable"
                  : "panel.sources.indexers.enableSearch",
              )
            }}
          </DropdownMenuItem>
          <DropdownMenuItem @select="actions.copyUrl(indexer)">
            <CopyIcon aria-hidden="true" />
            {{ t("panel.sources.indexers.copyUrl") }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" @select="emit('delete')">
            <Trash2Icon aria-hidden="true" />
            {{ t("panel.common.delete") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  </li>
</template>
