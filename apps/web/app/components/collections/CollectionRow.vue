<script setup lang="ts">
import type { Collection } from '@torsher/api-client'
import { EllipsisIcon, LibraryIcon, PencilIcon, Trash2Icon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const props = defineProps<{
  collection: Collection
  selected: boolean
  /** Имена профилей, от которых подборка скрыта */
  hiddenNames: string[]
}>()

const emit = defineEmits<{
  open: []
  edit: []
  delete: []
}>()

const { t } = useI18n()

const visibility = computed(() =>
  props.hiddenNames.length
    ? t('panel.collections.hiddenFrom', { names: props.hiddenNames.join(', ') })
    : t('panel.collections.visibleToAll'),
)
</script>

<template>
  <!-- Строку открывает кнопка-имя, растянутая на всю строку: меню «⋯» лежит поверх неё -->
  <li
    :class="
      cn(
        'group/row relative grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b py-2.5 pr-2.5 pl-4 text-[13.5px] hover:bg-muted/50 dark:hover:bg-muted',
        'sm:h-11 sm:grid-cols-[20px_minmax(0,240px)_minmax(0,1fr)_auto] sm:py-0',
        selected
          && 'bg-muted/50 dark:bg-muted shadow-[inset_2px_0_0_var(--primary)]',
      )
    "
  >
    <LibraryIcon
      class="row-span-2 mt-0.5 size-4 self-start justify-self-center text-muted-foreground sm:row-span-1 sm:mt-0 sm:self-center"
      aria-hidden="true"
    />
    <button
      type="button"
      class="col-start-2 row-start-1 min-w-0 truncate text-left font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
      :aria-current="selected || undefined"
      @click="emit('open')"
    >
      {{ collection.name }}
    </button>
    <span
      class="col-span-2 col-start-2 row-start-2 flex min-w-0 items-baseline gap-1.5 text-[13px] text-muted-foreground sm:col-span-1 sm:col-start-3 sm:row-start-1"
    >
      <span class="shrink-0 tabular-nums">{{
        t("panel.collections.titles", collection.count)
      }}</span>
      <span class="truncate">· {{ visibility }}</span>
    </span>
    <span
      class="col-start-3 row-start-1 flex items-center justify-end gap-1.5 text-[12.5px] whitespace-nowrap text-muted-foreground sm:col-start-4"
    >
      <Badge
        v-if="collection.showOnHome"
        variant="secondary"
        class="hidden sm:inline-flex"
      >
        {{ t("panel.collections.onHome") }}
      </Badge>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="relative size-7 sm:opacity-50 sm:group-focus-within/row:opacity-100 sm:group-hover/row:opacity-100 sm:aria-expanded:opacity-100"
            :class="{ 'sm:opacity-100': selected }"
            :aria-label="
              t('panel.collections.actions', { name: collection.name })
            "
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-auto min-w-48">
          <DropdownMenuItem @select="emit('edit')">
            <PencilIcon aria-hidden="true" />
            {{ t("panel.collections.edit") }}
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
