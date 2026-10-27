<script setup lang="ts">
import type { Backdrop } from '@torsher/api-client'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api.ts'
import holdVideo from '../assets/screensaver-hold.mp4'
import { useCatalogLanguage } from '../composables/useCatalogLanguage.ts'
import { formatClock } from '../lib/player.ts'
import { cornerOf, shuffled, SLIDE_MS } from '../lib/screensaver.ts'
import { holdAndroidScreen, isAndroidShell } from '../platform/android.ts'
import { holdSystemScreensaver, isWebos } from '../platform/webos.ts'
import { session } from '../session.ts'

/**
 * Заставка при простое: медленная смена кадров TMDB с названием и часами, как
 * Aerial у Apple TV. Только `opacity` и `transform`. Без подключения или без
 * кадров — часы на чёрном: неподвижная витрина выгорает и на экране кода.
 *
 * На webOS заставка держит экран: иначе ТВ включает свою поверх. Система не
 * включает заставку, пока на весь экран идёт видео, поэтому под кадрами
 * крутится чёрный беззвучный ролик; вдобавок — отказ на запрос tvpower.
 * `resting` гасит кадры в чёрный и отдаёт экран системе.
 */
const props = defineProps<{ resting: boolean }>()

const { locale } = useI18n()
const language = useCatalogLanguage()

// Кадры живут дольше одной заставки: тренд дня меняется раз в сутки
const CACHE_MS = 30 * 60 * 1000
let cached: { items: Backdrop[], language: string, at: number } | undefined

async function loadBackdrops() {
  if (session.status !== 'ready')
    return []

  if (
    cached
    && cached.language === language.value
    && Date.now() - cached.at < CACHE_MS
  ) {
    return cached.items
  }

  try {
    const { items } = await api.catalog.getCatalogBackdrops({
      language: language.value,
    })

    cached = { items, language: language.value, at: Date.now() }

    return items
  }
  catch {
    return []
  }
}

interface Layer {
  slide: number
  item: Backdrop
}

// Два слоя с кроссфейдом: новый кадр показывается, только когда загрузился
const layers = ref<(Layer | undefined)[]>([undefined, undefined])
const front = ref(0)
const slide = ref(0)
const shown = computed(() => layers.value[front.value]?.item)
const corner = computed(() => cornerOf(slide.value))

const now = ref(new Date())
const clock = computed(() => formatClock(now.value, locale.value))

let order: Backdrop[] = []
let position = 0
let slideTimer: ReturnType<typeof setTimeout> | undefined
let clockTimer: ReturnType<typeof setInterval> | undefined
let stopped = false

function preload(src: string) {
  return new Promise<boolean>((resolve) => {
    const image = new Image()

    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
    image.src = src
  })
}

async function advance() {
  if (stopped)
    return

  // Битый кадр пропускаем; если не загрузился ни один из круга — остаются часы
  for (let tries = 0; tries < order.length; tries++) {
    if (position >= order.length) {
      order = shuffled(order, Math.random, order[order.length - 1])
      position = 0
    }

    const item = order[position++]!

    if (await preload(item.backdrop)) {
      if (stopped)
        return

      const back = 1 - front.value

      slide.value += 1
      layers.value = layers.value.map((layer, index) =>
        index === back ? { slide: slide.value, item } : layer,
      )
      // Новый слой сначала встаёт прозрачным, иначе кроссфейда не будет
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          front.value = back
        }),
      )
      break
    }
  }

  if (!order.length)
    slide.value += 1

  slideTimer = setTimeout(advance, SLIDE_MS)
}

const webos = isWebos()
const hold = ref<HTMLVideoElement>()
let releaseHold: (() => void) | undefined

function holdScreen() {
  releaseHold = holdSystemScreensaver()

  const video = hold.value

  if (video) {
    video.src = holdVideo
    // Не запустился — экран держит только ответ tvpower
    video.play().catch(() => {})
  }
}

// Без `src` и `load()` браузер держит ролик и аппаратный декодер
function releaseScreen() {
  releaseHold?.()
  releaseHold = undefined

  const video = hold.value

  if (video) {
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
}

function stop() {
  stopped = true
  clearTimeout(slideTimer)
  clearInterval(clockTimer)
}

watch(
  () => props.resting,
  (resting) => {
    if (resting) {
      stop()
      releaseScreen()
    }
  },
)

onMounted(async () => {
  if (webos)
    holdScreen()
  // На Android экран держит окно оболочки, ролик-удержание не нужен
  else if (isAndroidShell)
    releaseHold = holdAndroidScreen()

  clockTimer = setInterval(() => {
    now.value = new Date()
  }, 10_000)

  order = shuffled(await loadBackdrops())
  void advance()
})

onBeforeUnmount(() => {
  stop()
  releaseScreen()
})
</script>

<template>
  <div class="saver" aria-hidden="true">
    <video v-if="webos" ref="hold" class="saver__hold" muted loop playsinline />

    <div class="saver__scene" :class="{ 'saver__scene--resting': resting }">
      <template v-for="(layer, index) in layers" :key="index">
        <img
          v-if="layer"
          :key="layer.slide"
          class="saver__image"
          :class="{ 'saver__image--front': index === front }"
          :src="layer.item.backdrop"
          alt=""
          decoding="async"
        >
      </template>
      <div class="saver__shade" :class="`saver__shade--${corner}`" />

      <div
        :key="slide"
        class="saver__caption"
        :class="`saver__caption--${corner}`"
      >
        <p class="saver__clock">
          {{ clock }}
        </p>
        <p v-if="shown" class="saver__title">
          {{ shown.title
          }}<span v-if="shown.year" class="saver__year">
            · {{ shown.year }}</span>
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.saver {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 100;
  overflow: hidden;
  background: #000;
  cursor: none;
}

/*
 * Ролик ровно во весь экран: «видео на весь экран» система определяет по окну
 * вывода, и ролик с полями её не останавливает. Кадры рисуются поверх
 */
.saver__hold {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
}

.saver__scene {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  transition: opacity 2s var(--motion-easing);
}

/* Предел заставки: чёрный экран, OLED не горит, экран отдан системе */
.saver__scene--resting {
  opacity: 0;
}

/* Медленный наезд на весь показ кадра; слой на своём слое GPU, как фон главной */
.saver__image {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 2s var(--motion-easing);
  will-change: transform, opacity;
  animation: saver-drift 24s linear both;
}

.saver__image--front {
  opacity: 1;
}

@keyframes saver-drift {
  from {
    transform: scale(1) translate(0, 0);
  }

  to {
    transform: scale(1.08) translate(-1.5%, -1%);
  }
}

/* Затемнение под подписью: градиент из угла, без filter и backdrop-filter */
.saver__shade {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.saver__shade--bottomLeft {
  background-image: radial-gradient(ellipse at 0% 100%, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0) 55%);
}

.saver__shade--bottomRight {
  background-image: radial-gradient(ellipse at 100% 100%, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0) 55%);
}

.saver__shade--topLeft {
  background-image: radial-gradient(ellipse at 0% 0%, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0) 55%);
}

.saver__shade--topRight {
  background-image: radial-gradient(ellipse at 100% 0%, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0) 55%);
}

.saver__caption {
  position: absolute;
  max-width: calc(var(--u) * 900);
  animation: saver-caption 2s var(--motion-easing) both;
}

@keyframes saver-caption {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

.saver__caption--bottomLeft {
  bottom: var(--safe-y);
  left: var(--safe-x);
}

.saver__caption--bottomRight {
  right: var(--safe-x);
  bottom: var(--safe-y);
  text-align: right;
}

.saver__caption--topLeft {
  top: var(--safe-y);
  left: var(--safe-x);
}

.saver__caption--topRight {
  top: var(--safe-y);
  right: var(--safe-x);
  text-align: right;
}

.saver__clock {
  margin: 0;
  font-size: calc(var(--u) * 96);
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.02em;
}

.saver__title {
  margin: calc(var(--u) * 14) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-m);
  font-weight: 600;
}

.saver__year {
  font-weight: 400;
}

@media (prefers-reduced-motion: reduce) {
  .saver__image {
    animation: none;
  }
}
</style>
