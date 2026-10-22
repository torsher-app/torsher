<script setup lang="ts">
import type { SourceCandidate } from '@torsher/api-client'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSourceLabels } from '../composables/useSourceLabels.ts'
import {
  bitrateOf,
  coverageLabel,
  formatBitrate,
  leechersOf,
} from '../lib/sources.ts'
import { formatPublishDate } from '../lib/titleInfo.ts'
import AppIcon from './AppIcon.vue'
import AppLoader from './AppLoader.vue'

/**
 * Строка раздачи в «Источниках»: причина и озвучка · бейджи, исходное имя и
 * мета-строка · размер, сиды, качают и индексатор.
 */
const props = defineProps<{
  candidate: SourceCandidate
  // Длительность серии или фильма в минутах — для среднего битрейта
  runtime?: number
  // Раздачу подключают: лоадер поверх колонки размера и сидов, строка не двигается
  loading?: boolean
}>()

const emit = defineEmits<{ select: [] }>()

const { t, locale } = useI18n()
const { voiceLabel, otherTracksLine, candidateSize, seedersLabel }
  = useSourceLabels()

// Раздача последнего просмотра — главное, что нужно знать о строке; иначе причина выбора
const reason = computed(() => {
  if (props.candidate.lastWatched)
    return t('sources.lastWatched')

  return props.candidate.pickReason
    ? t(`sources.reasons.${props.candidate.pickReason}`)
    : ''
})

const badges = computed(() =>
  [
    coverageLabel(props.candidate),
    props.candidate.quality,
    props.candidate.source,
    ...props.candidate.hdr,
    props.candidate.codec,
    props.candidate.channels,
  ].filter((value): value is NonNullable<typeof value> => !!value),
)

function subsLabel(subs: string[]) {
  const known = subs.filter(code => code !== 'und')

  if (known.length > 0)
    return t('sources.subs', { list: known.join(', ').toUpperCase() })

  return subs.length > 0 ? t('sources.subsAny') : ''
}

/** Под исходным именем: дата публикации · средний битрейт · субтитры */
const meta = computed(() => {
  const bitrate = bitrateOf(props.candidate, props.runtime)

  return [
    props.candidate.publishedAt
      ? formatPublishDate(
          props.candidate.publishedAt,
          locale.value.replace('_', '-'),
        )
      : '',
    bitrate === undefined
      ? ''
      : t('sources.bitrate', { n: formatBitrate(bitrate, locale.value) }),
    subsLabel(props.candidate.subs),
  ]
    .filter(Boolean)
    .join(' · ')
})

const leechers = computed(() => {
  const count = leechersOf(props.candidate)

  return count === undefined ? '' : t('sources.leechers', count)
})

const seedersTone = computed(() => {
  const count = props.candidate.seeders

  if (count === 0)
    return 'bad'

  return count < 10 ? 'warn' : 'ok'
})
</script>

<template>
  <button v-focusable class="source" type="button" @click="emit('select')">
    <span class="source__lead">
      <span class="source__voice">{{ voiceLabel(candidate.voice) }}</span>
      <span
        v-if="candidate.voice?.studio && candidate.voice.type"
        class="source__dim"
      >
        {{ t(`sources.voiceTypes.${candidate.voice.type}`) }}
      </span>
      <span v-if="otherTracksLine(candidate)" class="source__dim">
        {{ otherTracksLine(candidate) }}
      </span>
      <span v-if="candidate.confidence === 'medium'" class="source__unsure">
        {{ t("sources.unsure") }}
      </span>
    </span>
    <span class="source__body">
      <span class="source__badges">
        <span v-for="badge in badges" :key="badge" class="source__badge">
          {{ badge }}
        </span>
      </span>
      <span class="source__name">{{ candidate.title }}</span>
      <!-- Отметка — в строке даты: она есть у каждой строки, высота строк не меняется -->
      <span v-if="meta || reason" class="source__meta">
        <span v-if="reason" class="source__tag">
          <AppIcon
            v-if="candidate.lastWatched"
            name="recent"
            class="source__tag-icon"
          />
          {{ reason }}
        </span>
        <span v-if="reason && meta" class="source__sep">·</span>
        <span class="source__meta-text">{{ meta }}</span>
      </span>
    </span>
    <span class="source__side">
      <span>{{ candidateSize(candidate) }}</span>
      <span :class="`source__seeders source__seeders--${seedersTone}`">
        {{ seedersLabel(candidate.seeders) }}
      </span>
      <span v-if="leechers" class="source__dim">
        {{ leechers }}
      </span>
      <span class="source__dim">{{ candidate.indexers.join(", ") }}</span>
    </span>
    <span v-if="loading" class="source__loading">
      <AppLoader :size="48" :label="t('sources.connecting')" />
    </span>
  </button>
</template>

<style scoped>
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
  position: relative;
  font: inherit;
  text-align: left;
  /*
   * Заливка без перехода: список прокручивается нативно и сразу, и гаснущая
   * подложка прошлой строки прыгала бы вместе с прокруткой
   */
  transition: transform var(--motion-base) var(--motion-easing);
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

.source__meta {
  display: flex;
  align-items: center;
  margin-top: calc(var(--u) * 8);
  color: var(--color-text-dim);
  font-size: var(--font-size-s);
  white-space: nowrap;
}

.source__tag {
  display: flex;
  flex: none;
  align-items: center;
  color: var(--color-accent);
  font-weight: 600;
}

.source__tag-icon {
  margin-right: calc(var(--u) * 6);
}

.source__sep {
  margin: 0 calc(var(--u) * 8);
}

.source__meta-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.source:focus .source__tag {
  color: var(--color-accent-ink);
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
.source:focus .source__dim,
.source:focus .source__name,
.source:focus .source__meta,
.source:focus .source__seeders,
.source:focus .source__unsure {
  color: var(--color-bg);
}

.source:focus .source__badge {
  border-color: rgba(0, 0, 0, 0.3);
}
/* Лоадер подключения — поверх колонки справа, раскладка строки не меняется.
   Подложка появляется вместе с лоадером: быстрое подключение не прячет колонку */
.source__loading {
  opacity: 0;
  animation: source-loading var(--motion-fast) var(--motion-easing) var(--loader-delay) forwards;
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--u) * 360);
  border-radius: 0 calc(var(--u) * 16) calc(var(--u) * 16) 0;
  background: linear-gradient(90deg, rgba(31, 36, 48, 0) 0%, var(--color-surface-raised) 30%);
}

.source:focus .source__loading {
  background: linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, #fff 30%);
}

.source:focus .source__loading :deep(.loader__label) {
  color: var(--color-bg);
}

@keyframes source-loading {
  to {
    opacity: 1;
  }
}
</style>
