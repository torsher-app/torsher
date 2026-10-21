<script setup lang="ts">
import type { SourceCandidate, TitleSources } from '@torsher/api-client'
import type { ResourceStatus } from '../composables/useResource.ts'
import type { Quality, SourceFilter } from '../lib/sources.ts'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSourceLabels } from '../composables/useSourceLabels.ts'
import { useFocus } from '../focus/index.ts'
import {
  filteredCount,
  minutesSince,
  qualityOptions,
  visibleCandidates,
} from '../lib/sources.ts'
import FocusSection from './FocusSection.vue'

const props = defineProps<{
  sources?: TitleSources
  status: ResourceStatus
  // «S2E5» у сериала; у фильма пусто
  context: string
}>()

const emit = defineEmits<{
  select: [candidateId: string]
  close: []
  refresh: []
}>()

const { t } = useI18n()
const focus = useFocus()
const { voiceLabel, candidateSize, seedersLabel } = useSourceLabels()

const filter = ref<SourceFilter>({})
const showAll = ref(false)
// Время для «обновлено N мин назад» берём при открытии листа
const openedAt = new Date()

const qualities = computed(() =>
  props.sources ? qualityOptions(props.sources.candidates) : [],
)
const voices = computed(() => props.sources?.voices ?? [])
const rows = computed(() =>
  props.sources
    ? visibleCandidates(props.sources, filter.value, showAll.value)
    : [],
)
const total = computed(() =>
  props.sources ? filteredCount(props.sources, filter.value) : 0,
)
const hasFilter = computed(
  () => !!filter.value.voice || !!filter.value.quality,
)

const emptyKind = computed(() => {
  if (!props.sources || rows.value.length > 0)
    return undefined

  if (props.sources.indexers.total === 0)
    return 'noIndexers'

  return hasFilter.value ? 'filtered' : 'nothing'
})

const updatedLabel = computed(() => {
  if (!props.sources)
    return ''

  const minutes = minutesSince(props.sources.updatedAt, openedAt)

  return minutes === 0
    ? t('sources.updatedNow')
    : t('sources.updated', { n: minutes })
})

const headerMeta = computed(() => {
  const parts = [props.context]

  if (props.sources) {
    parts.push(
      t('sources.count', props.sources.candidates.length),
      updatedLabel.value,
    )
  }

  return parts.filter(Boolean).join(' · ')
})

function setVoice(key: string | undefined) {
  filter.value = {
    ...filter.value,
    voice: filter.value.voice === key ? undefined : key,
  }
}

function setQuality(quality: Quality) {
  filter.value = {
    ...filter.value,
    quality: filter.value.quality === quality ? undefined : quality,
  }
}

function clearFilter() {
  filter.value = {}
}

function badgesOf(candidate: SourceCandidate) {
  return [
    candidate.quality,
    candidate.source,
    ...candidate.hdr,
    candidate.codec,
  ].filter((value): value is NonNullable<typeof value> => !!value)
}

function seedersTone(count: number) {
  if (count === 0)
    return 'bad'

  return count < 10 ? 'warn' : 'ok'
}

// Пока идёт поиск, фокус стоит на заглушке; ответ пришёл — встаём в список
watch(
  () => props.status,
  (status) => {
    if (status === 'ready' || status === 'error')
      nextTick(() => focus.activate('sources-list'))
  },
)

const stopKey = focus.onKey((action) => {
  if (action.type !== 'back')
    return false

  emit('close')

  return true
})

onBeforeUnmount(stopKey)
</script>

<template>
  <div class="sheet">
    <div class="sheet__scrim" @click="emit('close')" />
    <section class="sheet__panel" :aria-label="t('sources.title')">
      <header class="sheet__head">
        <h2 class="sheet__title">
          {{ t("sources.title") }}
        </h2>
        <p class="sheet__meta">
          {{ headerMeta }}
        </p>
        <p v-if="sources" class="sheet__profile">
          {{
            t("sources.profile", {
              qualities: sources.profile.qualities.join(" → "),
            })
          }}
          <span v-if="sources.indexers.failed.length > 0" class="sheet__warn">
            ·
            {{
              t("sources.failed", {
                failed: sources.indexers.failed.length,
                total: sources.indexers.total,
              })
            }}
          </span>
        </p>
      </header>

      <FocusSection
        v-if="sources && sources.candidates.length > 0"
        name="sources-filters"
        class="sheet__filters"
        :edges="{ down: 'sources-list' }"
      >
        <button
          v-focusable
          class="chip"
          :class="{ 'chip--selected': !hasFilter }"
          type="button"
          @click="clearFilter"
        >
          {{ t("sources.all") }}
        </button>
        <button
          v-for="option in voices"
          :key="option.key"
          v-focusable
          class="chip"
          :class="{ 'chip--selected': filter.voice === option.key }"
          type="button"
          @click="setVoice(option.key)"
        >
          {{ voiceLabel(option) }}
        </button>
        <span class="sheet__divider" />
        <button
          v-for="quality in qualities"
          :key="quality"
          v-focusable
          class="chip"
          :class="{ 'chip--selected': filter.quality === quality }"
          type="button"
          @click="setQuality(quality)"
        >
          {{ quality }}
        </button>
      </FocusSection>

      <FocusSection
        name="sources-list"
        class="sheet__list"
        :edges="{ up: 'sources-filters' }"
        autofocus
      >
        <div
          v-if="status === 'loading' || status === 'idle'"
          v-focusable
          class="sheet__state"
          tabindex="-1"
        >
          <p class="sheet__state-title">
            {{ t("watch.searching") }}
          </p>
        </div>

        <div v-else-if="status === 'error'" class="sheet__state">
          <p class="sheet__state-title">
            {{ t("watch.searchFailed") }}
          </p>
          <button
            v-focusable
            class="action"
            type="button"
            @click="emit('refresh')"
          >
            {{ t("sources.refresh") }}
          </button>
        </div>

        <template v-else>
          <div v-if="emptyKind" class="sheet__state">
            <p class="sheet__state-title">
              {{ t(`sources.empty.${emptyKind}.title`) }}
            </p>
            <p class="sheet__state-text">
              {{ t(`sources.empty.${emptyKind}.text`) }}
            </p>
          </div>

          <button
            v-for="candidate in rows"
            :key="candidate.id"
            v-focusable
            class="source"
            type="button"
            @click="emit('select', candidate.id)"
          >
            <span class="source__lead">
              <span v-if="candidate.pickReason" class="source__reason">
                {{ t(`sources.reasons.${candidate.pickReason}`) }}
              </span>
              <span class="source__voice">{{
                voiceLabel(candidate.voice)
              }}</span>
              <span
                v-if="candidate.voice?.studio && candidate.voice.type"
                class="source__dim"
              >
                {{ t(`sources.voiceTypes.${candidate.voice.type}`) }}
              </span>
              <span
                v-if="candidate.confidence === 'medium'"
                class="source__unsure"
              >
                {{ t("sources.unsure") }}
              </span>
            </span>
            <span class="source__body">
              <span class="source__badges">
                <span
                  v-for="badge in badgesOf(candidate)"
                  :key="badge"
                  class="source__badge"
                >
                  {{ badge }}
                </span>
              </span>
              <span class="source__name">{{ candidate.title }}</span>
            </span>
            <span class="source__side">
              <span>{{ candidateSize(candidate) }}</span>
              <span
                :class="`source__seeders source__seeders--${seedersTone(candidate.seeders)}`"
              >
                {{ seedersLabel(candidate.seeders) }}
              </span>
              <span class="source__dim">{{
                candidate.indexers.join(", ")
              }}</span>
            </span>
          </button>

          <div class="sheet__footer">
            <button
              v-if="!showAll && total > rows.length"
              v-focusable
              class="action"
              type="button"
              @click="showAll = true"
            >
              {{ t("sources.showAll", { n: total }) }}
            </button>
            <button
              v-else-if="showAll && total > 0"
              v-focusable
              class="action"
              type="button"
              @click="showAll = false"
            >
              {{ t("sources.showTop") }}
            </button>
            <button
              v-focusable
              class="action"
              type="button"
              @click="emit('refresh')"
            >
              {{ t("sources.refresh") }}
            </button>
          </div>
        </template>
      </FocusSection>
    </section>
  </div>
</template>

<style scoped>
.sheet {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 20;
}

.sheet__scrim {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: rgba(0, 0, 0, 0.55);
}

.sheet__panel {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  height: calc(var(--u) * 864);
  padding: calc(var(--u) * 44) var(--safe-x) 0 var(--content-x);
  border-radius: var(--radius-l) var(--radius-l) 0 0;
  background: var(--color-surface);
}

.sheet__title {
  margin: 0;
  font-size: var(--font-size-l);
  font-weight: 700;
}

.sheet__meta,
.sheet__profile {
  margin: calc(var(--u) * 8) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.sheet__profile {
  color: var(--color-text-dim);
}

.sheet__warn {
  color: var(--color-warn);
}

.sheet__filters {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  margin: calc(var(--u) * 28) 0 calc(var(--u) * 20);
  overflow: hidden;
  padding: calc(var(--u) * 8) 0;
}

.sheet__divider {
  width: calc(var(--u) * 2);
  height: calc(var(--u) * 40);
  margin: 0 calc(var(--u) * 20) 0 calc(var(--u) * 6);
  background: var(--color-line);
}

/* Строки прокручиваются нативно: движок фокуса зовёт scrollIntoView */
.sheet__list {
  flex: 1;
  margin: 0 calc(var(--u) * -16);
  padding: calc(var(--u) * 12) calc(var(--u) * 16) calc(var(--u) * 40);
  overflow-y: auto;
}

.sheet__list::-webkit-scrollbar {
  display: none;
}

.sheet__state {
  padding: calc(var(--u) * 40) 0;
}

.sheet__state-title {
  margin: 0 0 calc(var(--u) * 12);
  font-size: var(--font-size-m);
  font-weight: 600;
}

.sheet__state-text {
  max-width: calc(var(--u) * 1100);
  margin: 0 0 calc(var(--u) * 24);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.sheet__footer {
  margin-top: calc(var(--u) * 24);
}

/* Строка раздачи: причина и озвучка · бейджи и исходное имя · размер и сиды */
.source {
  display: grid;
  grid-template-columns: calc(var(--u) * 360) 1fr calc(var(--u) * 300);
  grid-column-gap: calc(var(--u) * 32);
  align-items: center;
  width: 100%;
  margin-bottom: var(--space-1);
  padding: calc(var(--u) * 22) calc(var(--u) * 28);
  border: 0;
  border-radius: calc(var(--u) * 16);
  background: var(--color-surface-raised);
  color: var(--color-text);
  font: inherit;
  text-align: left;
}

.source:focus {
  --bump-scale: 1.02;

  background: var(--color-focus);
  color: var(--color-bg);
  transform: scale(var(--bump-scale));
}

.source__lead,
.source__body,
.source__side {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.source__side {
  align-items: flex-end;
  text-align: right;
}

.source__reason {
  margin-bottom: calc(var(--u) * 6);
  color: var(--color-accent);
  font-size: var(--font-size-s);
  font-weight: 600;
}

.source__voice {
  font-size: var(--font-size-m);
  font-weight: 600;
}

.source__dim,
.source__unsure {
  color: var(--color-text-dim);
  font-size: var(--font-size-s);
}

.source__unsure {
  color: var(--color-warn);
}

.source__badges {
  display: flex;
  flex-wrap: wrap;
  margin-bottom: calc(var(--u) * 8);
}

.source__badge {
  margin: 0 calc(var(--u) * 10) calc(var(--u) * 4) 0;
  padding: calc(var(--u) * 2) calc(var(--u) * 12);
  border: calc(var(--u) * 2) solid var(--color-line);
  border-radius: var(--radius-s);
  font-size: calc(var(--u) * 20);
  font-weight: 600;
}

.source__name {
  overflow: hidden;
  color: var(--color-text-muted);
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: calc(var(--u) * 20);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source__seeders {
  font-weight: 600;
}

.source__seeders--ok {
  color: var(--color-ok);
}

.source__seeders--warn {
  color: var(--color-warn);
}

.source__seeders--bad {
  color: var(--color-bad);
}

/* На белой заливке фокуса цветные подписи теряются: берём тёмный текст */
.source:focus .source__reason,
.source:focus .source__dim,
.source:focus .source__name,
.source:focus .source__seeders,
.source:focus .source__unsure {
  color: var(--color-bg);
}

.source:focus .source__badge {
  border-color: rgba(0, 0, 0, 0.3);
}
</style>
