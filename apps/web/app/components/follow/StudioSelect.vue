<script setup lang="ts">
import type { FollowVoicesResponse } from '@torsher/api-client'
import type { Studio } from '@torsher/release-parser/studio-search'
import {
  searchStudios,
  studioKey,
} from '@torsher/release-parser/studio-search'
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxRoot,
} from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { canonicalStudio, mergeStudioEvidence } from '~/lib/followVoiceRules'
import { createStudioSelectIntent } from '~/lib/studioSelectIntent'
import { Input } from '@/components/ui/input'

const props = defineProps<{
  modelValue?: string
  collection: readonly Studio[]
  items: FollowVoicesResponse['items']
  saved?: string
  season: number
  disabled?: boolean
  invalid?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { t } = useI18n()
const query = ref('')
const open = ref(false)
const root = ref<HTMLElement>()
const intent = createStudioSelectIntent()
const evidence = computed(() =>
  mergeStudioEvidence(props.items, props.collection),
)

const results = computed(() => {
  const matches = searchStudios(query.value, props.collection).map(
    result => ({
      ...result,
      evidence: evidence.value.get(result.studio.name),
      saved:
        !!props.saved
        && canonicalStudio(props.saved, props.collection) === result.studio.name,
    }),
  )
  if (!studioKey(query.value)) {
    matches.sort(
      (a, b) =>
        Number(b.saved) - Number(a.saved)
        || Number(!!b.evidence?.found) - Number(!!a.evidence?.found),
    )
  }
  return matches
})

watch(
  [
    query,
    () =>
      results.value
        .map(
          item =>
            `${item.studio.name}:${item.match}:${item.evidence?.found}:${item.evidence?.count}:${item.saved}:${item.evidence?.inherited}`,
        )
        .join('|'),
  ],
  intent.reset,
  { flush: 'sync' },
)
watch(open, intent.reset, { flush: 'sync' })

/** Runs on the DOM ancestor before Reka can translate Enter to a synthetic click. */
function guardKey(event: KeyboardEvent) {
  if (event.key === 'Escape')
    intent.reset()
  if (
    !event.isComposing
    && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
  ) {
    if (open.value && results.value.length > 0)
      intent.navigate()
  }
  if (event.key !== 'Enter')
    return
  event.preventDefault()
  event.stopPropagation()
  const input = event.target as HTMLElement
  const highlighted = input.getAttribute('aria-activedescendant')
  const option = highlighted ? document.getElementById(highlighted) : undefined
  const name = option?.getAttribute('data-studio')
  const current
    = open.value
      && option
      && root.value?.contains(option)
      && option.getAttribute('role') === 'option'
      && !option.hasAttribute('data-disabled')
      && results.value.some(result => result.studio.name === name)
  const selected = intent.enter(
    current ? name! : undefined,
    event.isComposing || event.keyCode === 229,
  )
  if (!props.disabled && selected)
    commit(selected)
}
function commit(name: string) {
  emit('update:modelValue', name)
  open.value = false
  query.value = ''
  intent.reset()
}
function choose(event: Event, name: string) {
  event.preventDefault()
  if (!props.disabled && intent.select(name))
    commit(name)
}

function group(index: number) {
  const result = results.value[index]!
  if (result.match === 'fuzzy')
    return 'suggestions'
  if (studioKey(query.value))
    return 'matches'
  return result.saved || result.evidence?.found ? 'seasonGroup' : 'otherGroup'
}
</script>

<template>
  <div
    ref="root"
    class="relative min-w-0"
    @keydown.capture="guardKey"
    @compositionstart.capture="intent.composition(true)"
    @compositionend.capture="intent.composition(false)"
    @pointercancel.capture="intent.reset"
    @blur.capture="intent.reset"
  >
    <ComboboxRoot
      v-model:open="open"
      :model-value="modelValue || undefined"
      :disabled="disabled"
      ignore-filter
      open-on-focus
      open-on-click
      :reset-search-term-on-blur="false"
      :reset-search-term-on-select="false"
      :reset-model-value-on-clear="false"
      :highlight-on-hover="false"
    >
      <ComboboxAnchor>
        <ComboboxInput
          id="follow-studio-list"
          v-model="query"
          as-child
          :display-value="() => ''"
        >
          <Input
            :placeholder="t('follow.studio.searchPlaceholder')"
            :aria-label="t('follow.studio.searchPlaceholder')"
            :aria-invalid="invalid || undefined"
          />
        </ComboboxInput>
      </ComboboxAnchor>
      <ComboboxContent
        class="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      >
        <p v-if="!results.length" class="p-2 text-sm text-muted-foreground">
          {{ t("follow.studio.noMatches") }}
        </p>
        <template v-for="(result, index) in results" :key="result.studio.name">
          <p
            v-if="index === 0 || group(index) !== group(index - 1)"
            class="px-2 py-1.5 text-xs font-medium text-muted-foreground"
          >
            {{ t(`follow.studio.${group(index)}`) }}
          </p>
          <ComboboxItem
            :value="result.studio.name"
            :text-value="result.studio.name"
            :data-studio="result.studio.name"
            class="rounded-sm px-2 py-1.5 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
            @pointerdown="intent.pointer(result.studio.name)"
            @mousedown.prevent
            @select="choose($event, result.studio.name)"
          >
            <span class="block break-words">{{ result.studio.name
            }}<span v-if="result.saved" class="ml-2 text-xs">{{
              t("follow.studio.saved")
            }}</span></span>
            <span class="block text-xs text-muted-foreground">
              {{
                result.evidence?.found
                  ? t(
                    season
                      ? "follow.studio.foundSeason"
                      : "follow.studio.foundMovie",
                    { count: result.evidence.count, season },
                  )
                  : t("follow.studio.notFound")
              }}
            </span>
            <span
              v-if="result.evidence?.inherited"
              class="block text-xs text-muted-foreground"
            >{{ t("follow.studio.inherited") }}</span>
          </ComboboxItem>
        </template>
      </ComboboxContent>
    </ComboboxRoot>
    <p v-if="modelValue" class="mt-1.5 break-words text-sm">
      {{ t("follow.studio.draft", { studio: modelValue }) }}
    </p>
  </div>
</template>
