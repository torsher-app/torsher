<script setup lang="ts">
import type { SourceCandidate } from '@torsher/api-client'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSourceLabels } from '../composables/useSourceLabels.ts'
import {
  bitrateOf,
  coverageLabel,
  formatBitrate,
  hdrLabels,
  leechersOf,
  resolutionBadge,
  sourceKindOf,
} from '../lib/sources.ts'
import { formatPublishDate } from '../lib/titleInfo.ts'
import AppIcon from './AppIcon.vue'
import AppLoader from './AppLoader.vue'

/**
 * Строка раздачи в «Источниках» на всю ширину, в три строки: исходное имя;
 * бейджи и озвучка; причина, дата и индексатор · битрейт, сиды, качают, размер.
 */
const props = defineProps<{
  candidate: SourceCandidate
  // Длительность серии или фильма в минутах — для среднего битрейта
  runtime?: number
  // Раздачу подключают: лоадер поверх цифр справа, строка не двигается
  loading?: boolean
}>()

const emit = defineEmits<{ select: [] }>()

const { t, locale } = useI18n()
const { voiceLabel, otherTracksLine, sizeLabel } = useSourceLabels()

// Раздача последнего просмотра — главное, что нужно знать о строке; иначе причина выбора
const reason = computed(() => {
  if (props.candidate.lastWatched)
    return t('sources.lastWatched')

  return props.candidate.pickReason
    ? t(`sources.reasons.${props.candidate.pickReason}`)
    : ''
})

// Разрешение — первым бейджем: он есть у каждой строки, колонка ровная.
// Экранная копия подсвечена: смотреть её почти никогда не хотят
const badges = computed(() => {
  const kind = sourceKindOf(props.candidate.source)

  return [
    coverageLabel(props.candidate) && {
      text: coverageLabel(props.candidate),
      warn: false,
    },
    kind && { text: t(`sources.sourceKinds.${kind}`), warn: kind === 'cam' },
    ...[
      ...hdrLabels(props.candidate.hdr),
      props.candidate.codec,
      props.candidate.channels,
    ].map(text => text && { text, warn: false }),
  ].filter((badge): badge is { text: string, warn: boolean } => !!badge)
})

function subsLabel(subs: string[]) {
  const known = subs.filter(code => code !== 'und')

  if (known.length > 0)
    return t('sources.subs', { list: known.join(', ').toUpperCase() })

  return subs.length > 0 ? t('sources.subsAny') : ''
}

/** Слева внизу: дата публикации · субтитры · индексатор */
const meta = computed(() =>
  [
    props.candidate.publishedAt
      ? formatPublishDate(
          props.candidate.publishedAt,
          locale.value.replace('_', '-'),
        )
      : '',
    subsLabel(props.candidate.subs),
    props.candidate.indexers.join(', '),
  ]
    .filter(Boolean)
    .join(' · '),
)

const bitrate = computed(() => {
  const mbps = bitrateOf(props.candidate, props.runtime)

  return mbps === undefined
    ? ''
    : t('sources.bitrate', { n: formatBitrate(mbps, locale.value) })
})

const voiceType = computed(() => {
  const voice = props.candidate.voice

  return voice?.studio && voice.type
    ? t(`sources.voiceTypes.${voice.type}`)
    : ''
})

const leechers = computed(() => leechersOf(props.candidate))

const seedersTone = computed(() => {
  const count = props.candidate.seeders

  if (count === 0)
    return 'bad'

  return count < 10 ? 'warn' : 'ok'
})
</script>

<template>
  <button v-focusable class="source" type="button" @click="emit('select')">
    <span class="source__name">{{ candidate.title }}</span>
    <span class="source__tags">
      <span
        class="source__badge source__badge--resolution"
        :class="{ 'source__badge--unknown': !candidate.resolution }"
      >
        {{ resolutionBadge(candidate.resolution) }}
      </span>
      <span
        v-for="badge in badges"
        :key="badge.text"
        class="source__badge"
        :class="{ 'source__badge--warn': badge.warn }"
      >
        {{ badge.text }}
      </span>
      <span
        class="source__voice"
        :class="{ 'source__voice--none': !candidate.voice }"
      >
        <AppIcon name="audio" class="source__voice-icon" />
        {{ voiceLabel(candidate.voice) }}
        <span v-if="voiceType" class="source__voice-type">
          · {{ voiceType }}
        </span>
      </span>
      <span v-if="otherTracksLine(candidate)" class="source__dim">
        {{ otherTracksLine(candidate) }}
      </span>
      <span v-if="candidate.confidence === 'medium'" class="source__unsure">
        {{ t("sources.unsure") }}
      </span>
    </span>
    <span class="source__foot">
      <!-- Отметка — в нижней строке: она есть у каждой строки, высота строк не меняется -->
      <span class="source__meta">
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
      <span class="source__stats">
        <!-- Значки вместо подписей: стрелки отдачи и закачки, как в торрент-клиентах -->
        <span v-if="bitrate" class="source__stat">
          <AppIcon name="gauge" class="source__stat-icon" />
          {{ bitrate }}
        </span>
        <span
          class="source__stat"
          :class="`source__seeders source__seeders--${seedersTone}`"
        >
          <AppIcon name="arrowUp" class="source__stat-icon" />
          {{ candidate.seeders }}
        </span>
        <span v-if="leechers !== undefined" class="source__stat">
          <AppIcon name="arrowDown" class="source__stat-icon" />
          {{ leechers }}
        </span>
        <span v-if="candidate.size !== null" class="source__size">
          {{ sizeLabel(candidate.size) }}
        </span>
      </span>
    </span>
    <span v-if="loading" class="source__loading">
      <AppLoader :size="48" :label="t('sources.connecting')" />
    </span>
  </button>
</template>

<style scoped>
/* Строка раздачи: исходное имя · бейджи и озвучка · мета и цифры */
.source {
  display: flex;
  flex-direction: column;
  width: 100%;
  /* Целые пиксели ставит экран «Источники» (snapRowPitch), без них — по сетке */
  height: var(--source-row-height, auto);
  margin-bottom: var(--source-row-gap, calc(var(--u) * 12));
  padding: calc(var(--u) * 22) calc(var(--u) * 32);
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

.source__name {
  overflow: hidden;
  font-size: var(--font-size-m);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Бейджи и озвучка — одной строкой: лишнее уходит за край, высота не меняется */
.source__tags {
  display: flex;
  align-items: center;
  overflow: hidden;
  margin-top: calc(var(--u) * 12);
  white-space: nowrap;
}

.source__badge {
  flex: none;
  margin-right: calc(var(--u) * 10);
  padding: calc(var(--u) * 2) calc(var(--u) * 12);
  border: calc(var(--u) * 2) solid var(--color-line);
  border-radius: var(--radius-s);
  font-size: calc(var(--u) * 20);
  font-weight: 600;
}

/* Разрешение — главный бейдж: заливка и одна ширина, колонка ровная во всех строках */
.source__badge--resolution {
  min-width: calc(var(--u) * 96);
  border-color: transparent;
  background: rgba(255, 255, 255, 0.14);
  text-align: center;
}

.source__badge--unknown {
  border-style: dashed;
  border-color: var(--color-line);
  background: transparent;
  color: var(--color-text-dim);
}

.source__badge--warn {
  border-color: var(--color-warn);
  color: var(--color-warn);
}

.source__voice {
  flex: none;
  margin: 0 calc(var(--u) * 16) 0 calc(var(--u) * 6);
  font-size: var(--font-size-s);
  font-weight: 600;
}

.source__voice--none {
  color: var(--color-text-dim);
  font-weight: 400;
}

.source__voice-icon {
  margin-right: calc(var(--u) * 8);
  color: var(--color-text-dim);
}

.source__voice-type {
  margin-left: calc(var(--u) * 6);
  color: var(--color-text-muted);
  font-weight: 400;
}

.source__dim,
.source__unsure {
  margin-right: calc(var(--u) * 16);
  overflow: hidden;
  color: var(--color-text-dim);
  font-size: var(--font-size-s);
  text-overflow: ellipsis;
}

.source__unsure {
  flex: none;
  color: var(--color-warn);
}

.source__foot {
  display: flex;
  align-items: center;
  margin-top: calc(var(--u) * 12);
  font-size: var(--font-size-s);
  white-space: nowrap;
}

.source__meta {
  display: flex;
  flex: 1;
  align-items: center;
  min-width: 0;
  color: var(--color-text-dim);
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

.source__stats {
  display: flex;
  flex: none;
  align-items: center;
  margin-left: calc(var(--u) * 24);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.source__stat {
  margin-right: calc(var(--u) * 20);
}

.source__stat-icon {
  margin-right: calc(var(--u) * 6);
}

/*
 * Значок — в строке текста от базовой линии, как глиф: его середина совпадает
 * с серединой цифр, а позицию браузер считает вместе с текстом. Сдвиг через
 * transform рисуется на дробном пикселе, и в строках на разной дробной высоте
 * значок плавал относительно текста
 */
.source__stat .source__stat-icon,
.source__voice .source__voice-icon {
  display: inline-block;
  vertical-align: -0.125em;
}

/* Весь размер раздачи — светлой плашкой: сколько качать. Качество серии
   показывает битрейт */
.source__size {
  padding: calc(var(--u) * 2) calc(var(--u) * 12);
  border-radius: var(--radius-s);
  background: var(--color-text);
  color: var(--color-bg);
  font-weight: 600;
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
.source:focus .source__meta,
.source:focus .source__stats,
.source:focus .source__seeders,
.source:focus .source__unsure,
.source:focus .source__voice-icon,
.source:focus .source__voice-type,
.source:focus .source__voice--none {
  color: var(--color-bg);
}

.source:focus .source__size {
  background: var(--color-bg);
  color: var(--color-focus);
}

.source:focus .source__badge {
  border-color: rgba(0, 0, 0, 0.3);
}

.source:focus .source__badge--resolution {
  border-color: transparent;
  background: rgba(0, 0, 0, 0.12);
}

.source:focus .source__badge--unknown,
.source:focus .source__badge--warn {
  border-color: rgba(0, 0, 0, 0.3);
  background: transparent;
  color: var(--color-bg);
}

/* Лоадер подключения — поверх цифр справа, раскладка строки не меняется.
   Подложка появляется вместе с лоадером: быстрое подключение не прячет цифры */
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
  width: calc(var(--u) * 480);
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
