<script setup lang="ts">
import { GripVerticalIcon, XIcon } from '@lucide/vue'
import Draggable from 'vuedraggable'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  field: 'qualities' | 'voiceTypes' | 'audioLanguages'
  disabled: boolean
}>()
const items = defineModel<string[]>({ default: () => [] })
const { t } = useI18n()
const instructionId = useId()
const title = computed(() => t(`panel.settings.sources.${props.field}.title`))
const itemKey = (item: string) => item
function label(value: string) {
  return props.field === 'qualities'
    ? value === '2160p'
      ? '4K'
      : value
    : props.field === 'audioLanguages'
      ? t(`audioLanguages.${value}`)
      : t(`sources.voiceTypes.${value}`)
}
function move(index: number, offset: number) {
  if (
    props.disabled
    || index + offset < 0
    || index + offset >= items.value.length
  ) {
    return
  }
  const next = [...items.value]
  const item = next.splice(index, 1)[0]!
  next.splice(index + offset, 0, item)
  items.value = next
}
</script>

<template>
  <section class="grid gap-3">
    <div>
      <h3 class="text-sm font-semibold">
        {{ title }}
      </h3>
      <p class="mt-1 text-sm text-muted-foreground">
        {{ t(`panel.settings.sources.${field}.description`) }}
      </p>
    </div>
    <p :id="instructionId" class="sr-only">
      {{ t("panel.settings.sources.keyboardOrder") }}
    </p>
    <Draggable
      v-model="items"
      tag="ol"
      class="grid gap-2"
      :aria-label="title"
      :item-key="itemKey"
      handle=".source-drag-handle"
      :force-fallback="true"
      fallback-class="source-order-drag"
      chosen-class="source-order-chosen"
      :animation="180"
      :disabled="disabled"
    >
      <template #item="{ element: item, index }">
        <li
          :key="item"
          class="flex items-center gap-3 rounded-md border bg-card px-3 py-2"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="source-drag-handle shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
            :disabled="disabled"
            :aria-label="
              t('panel.settings.sources.move', { name: label(item) })
            "
            :aria-describedby="instructionId"
            @keydown.up.prevent="move(index, -1)"
            @keydown.down.prevent="move(index, 1)"
          >
            <GripVerticalIcon aria-hidden="true" />
          </Button>
          <span
            class="w-4 shrink-0 text-sm tabular-nums text-muted-foreground"
            aria-hidden="true"
          >{{ index + 1 }}</span>
          <span class="min-w-0 flex-1 text-sm">{{ label(item) }}</span>
          <Button
            v-if="field === 'audioLanguages'"
            type="button"
            size="icon-sm"
            variant="ghost"
            :disabled="disabled || items.length === 1"
            :aria-label="
              t('panel.settings.sources.removeLanguage', {
                language: label(item),
              })
            "
            @click="items = items.filter((value) => value !== item)"
          >
            <XIcon aria-hidden="true" />
          </Button>
        </li>
      </template>
    </Draggable>
  </section>
</template>

<style scoped>
/* Sortable sets an inline opacity on its fallback drag preview. */
.source-order-drag {
  opacity: 1 !important;
}
.source-order-chosen .source-drag-handle,
.source-order-drag .source-drag-handle {
  background-color: transparent;
  color: var(--muted-foreground);
  transition: none;
}
:global(body:has(.source-order-chosen)),
:global(body:has(.source-order-chosen) *) {
  cursor: grabbing !important;
}
</style>
