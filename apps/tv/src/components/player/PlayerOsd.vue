<script setup lang="ts">
import type { TorrentStats } from '@torsher/api-client'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  endsAt,
  formatClock,
  formatDuration,
  formatSpeed,
  networkState,
} from '../../lib/player.ts'
import ActionButton from '../ActionButton.vue'
import AppIcon from '../AppIcon.vue'
import ButtonRow from '../ButtonRow.vue'
import FocusSection from '../FocusSection.vue'
import PlayerTimeline from './PlayerTimeline.vue'
import SignalBars from './SignalBars.vue'

const props = defineProps<{
  visible: boolean
  title: string
  /** «Сезон 2 · Серия 1 · Название», без тайтла из каталога — имя файла */
  subtitle: string
  position: number
  duration: number
  bufferEnd: number
  scrubTarget: number | null
  paused: boolean
  stats: TorrentStats | undefined
  /** Секунд видео впереди позиции, уже скачанных */
  bufferSeconds: number
  now: Date
  /** Подписи кнопок дорожек; кнопки нет, если платформа дорожки не отдаёт */
  audioLabel: string | null
  subtitlesLabel: string | null
  /** Просмотр продолжен с сохранённого места: первой кнопкой — «С начала» */
  fromStart: boolean
  /** Плеер открыт из тайтла: кнопка «Источник», у сериала ещё «Серии» */
  titled: boolean
  series: boolean
  /** Вторая строка «Источника»: качество и кодек файла */
  sourceLabel: string
  /** Есть следующая вышедшая серия */
  hasNext: boolean
}>()

const emit = defineEmits<{
  toggle: []
  seek: [fraction: number]
  tracks: [kind: 'audio' | 'subtitles']
  panel: [kind: 'episodes' | 'source' | 'settings']
  next: []
  fromStart: []
}>()

const { t, locale } = useI18n()

const shown = computed(() => props.scrubTarget ?? props.position)
const remaining = computed(() =>
  Number.isFinite(props.duration) ? props.duration - shown.value : 0,
)

function bufferText(seconds: number) {
  return seconds >= 60
    ? t('player.bufferMinutes', { n: Math.floor(seconds / 60) })
    : t('player.bufferSeconds', { n: Math.floor(seconds) })
}

// Сеть — одним состоянием, а не сырыми цифрами: «0 пиров · 0 МБ/с» у
// скачанного файла выглядели бы поломкой
const network = computed(() => {
  const stats = props.stats

  if (!stats)
    return undefined

  return networkState({
    speed: stats.downloadSpeed,
    size: stats.file.size,
    downloaded: stats.file.downloaded,
    duration: props.duration,
    bufferSeconds: props.bufferSeconds,
    remaining: remaining.value,
  })
})

// Рядом с палочками — что важно сейчас: тающий запас, запас без сети или скорость
const networkText = computed(() => {
  const state = network.value

  if (!state || state.kind === 'done')
    return t('player.downloaded')

  if (state.low || state.level === 0)
    return bufferText(props.bufferSeconds)

  return t('player.speed', {
    value: formatSpeed(props.stats!.downloadSpeed, locale.value),
  })
})
</script>

<template>
  <div class="osd" :class="{ 'osd--visible': visible }">
    <div class="osd__scrim osd__scrim--top" />
    <div class="osd__scrim osd__scrim--bottom" />

    <header class="osd__top">
      <div class="osd__heading">
        <h1 class="osd__title">
          {{ title }}
        </h1>
        <p v-if="subtitle" class="osd__file">
          {{ subtitle }}
        </p>
      </div>
      <div class="osd__status">
        <span class="osd__clock">{{ formatClock(now, locale) }}</span>
        <span
          v-if="network"
          class="osd__pill"
          :class="{
            'osd__pill--quiet': network.kind === 'done',
            'osd__pill--low': network.kind === 'signal' && network.low,
          }"
        >
          <AppIcon
            v-if="network.kind === 'done'"
            name="check"
            class="osd__pill-icon"
          />
          <SignalBars
            v-else
            class="osd__pill-icon"
            :level="network.level"
            :low="network.low"
          />
          <span class="osd__pill-text">{{ networkText }}</span>
        </span>
      </div>
    </header>

    <div class="osd__bottom">
      <FocusSection
        name="player-timeline"
        :edges="{ up: 'player-back', down: 'player-buttons' }"
        manual-scroll
      >
        <PlayerTimeline
          :position="position"
          :duration="duration"
          :buffer-end="bufferEnd"
          :scrub-target="scrubTarget"
          @toggle="emit('toggle')"
          @seek="emit('seek', $event)"
        />
      </FocusSection>

      <div class="osd__times">
        <span class="osd__time">
          <AppIcon :name="paused ? 'pause' : 'play'" class="osd__state" />
          {{ formatDuration(shown) }}
        </span>
        <span v-if="Number.isFinite(duration)" class="osd__time">
          <b class="osd__remaining">{{
            t("player.remaining", { time: formatDuration(remaining) })
          }}</b>
          ·
          {{
            t("player.endsAt", {
              time: formatClock(endsAt(now, remaining), locale),
            })
          }}
        </span>
      </div>

      <FocusSection
        name="player-buttons"
        :edges="{ up: 'player-timeline' }"
        manual-scroll
      >
        <ButtonRow class="osd__buttons">
          <!-- Выделена, но фокус остаётся на таймлайне: OK там — пауза, а
               сюда переходят ↓, если правда нужно с начала -->
          <ActionButton
            v-if="fromStart"
            v-focusable
            primary
            icon="fromStart"
            :label="t('player.fromStart')"
            class="osd__button"
            @click="emit('fromStart')"
          />
          <ActionButton
            v-if="audioLabel !== null"
            v-focusable
            icon="audio"
            :label="t('player.audio')"
            :value="audioLabel"
            class="osd__button"
            @click="emit('tracks', 'audio')"
          />
          <ActionButton
            v-if="subtitlesLabel !== null"
            v-focusable
            icon="subtitles"
            :label="t('player.subtitles')"
            :value="subtitlesLabel"
            class="osd__button"
            @click="emit('tracks', 'subtitles')"
          />
          <ActionButton
            v-if="series"
            v-focusable
            icon="list"
            :label="t('player.episodes.button')"
            class="osd__button"
            @click="emit('panel', 'episodes')"
          />
          <ActionButton
            v-if="titled"
            v-focusable
            icon="source"
            :label="t('player.source.button')"
            :value="sourceLabel || undefined"
            class="osd__button"
            @click="emit('panel', 'source')"
          />
          <ActionButton
            v-if="hasNext"
            v-focusable
            icon="next"
            :label="t('player.next')"
            class="osd__button"
            @click="emit('next')"
          />
          <!-- Настройки — значком в своём блоке у правого края: кнопки ряда
               сжимаются до него, но не наезжают -->
          <template #end>
            <ActionButton
              v-focusable
              icon-only
              icon="settings"
              :label="t('player.settings.button')"
              class="osd__button osd__button--round"
              @click="emit('panel', 'settings')"
            />
          </template>
        </ButtonRow>
      </FocusSection>
    </div>
  </div>
</template>

<style scoped>
.osd {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--motion-base) var(--motion-easing);
}

.osd--visible {
  opacity: 1;
  pointer-events: auto;
}

.osd__scrim {
  position: absolute;
  right: 0;
  left: 0;
}

.osd__scrim--top {
  top: 0;
  height: calc(var(--u) * 300);
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0));
}

.osd__scrim--bottom {
  bottom: 0;
  height: calc(var(--u) * 520);
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.6) 55%, rgba(0, 0, 0, 0) 100%);
}

.osd__top {
  position: absolute;
  top: var(--safe-y);
  right: var(--safe-x);
  left: var(--safe-x);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.osd__heading {
  min-width: 0;
  margin-right: var(--space-5);
  /* Слева от названия — кнопка «Назад» экрана плеера */
  padding-left: calc(var(--u) * 120);
}

.osd__title {
  margin: 0 0 calc(var(--u) * 10);
  overflow: hidden;
  font-size: var(--font-size-xl);
  font-weight: 700;
  line-height: 1.05;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.osd__file {
  margin: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.osd__status {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  align-items: flex-end;
}

.osd__clock {
  margin-bottom: calc(var(--u) * 12);
  font-size: var(--font-size-l);
  font-weight: 600;
}

.osd__pill {
  display: inline-flex;
  align-items: center;
  height: calc(var(--u) * 44);
  padding: 0 calc(var(--u) * 18) 0 calc(var(--u) * 14);
  border-radius: calc(var(--u) * 22);
  background: var(--color-glass);
  font-size: var(--font-size-s);
  font-weight: 500;
  white-space: nowrap;
}

.osd__pill--quiet {
  color: var(--color-text-muted);
}

.osd__pill--low {
  color: var(--color-warn);
}

.osd__pill-icon {
  width: calc(var(--u) * 22);
  height: calc(var(--u) * 22);
  margin-right: calc(var(--u) * 10);
}

.osd__bottom {
  position: absolute;
  right: var(--safe-x);
  bottom: calc(var(--u) * 64);
  left: var(--safe-x);
}

.osd__times {
  display: flex;
  justify-content: space-between;
  margin: calc(var(--u) * 4) 0 calc(var(--u) * 26);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.osd__time {
  display: inline-flex;
  align-items: center;
}

.osd__state {
  width: calc(var(--u) * 22);
  height: calc(var(--u) * 22);
  margin-right: calc(var(--u) * 12);
  color: var(--color-text);
}

.osd__remaining {
  margin-right: calc(var(--u) * 8);
  color: var(--color-text);
  font-weight: 600;
}

.osd__button {
  --action-icon-gap: calc(var(--u) * 16);

  height: calc(var(--u) * 76);
  padding: 0 calc(var(--u) * 26);
  margin-right: calc(var(--u) * 18);
  font-size: var(--font-size-s);
}

.osd__button--round {
  justify-content: center;
  width: calc(var(--u) * 76);
  margin-right: 0;
  padding: 0;
  border-radius: 50%;
}

.osd__button :deep(.action-button__icon) {
  width: calc(var(--u) * 28);
  height: calc(var(--u) * 28);
}

.osd__button :deep(.action-button__text) {
  line-height: 1.12;
}

.osd__button :deep(.action-button__value) {
  font-size: calc(var(--u) * 22);
  opacity: 0.72;
}
</style>
