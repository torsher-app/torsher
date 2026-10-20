<script setup lang="ts">
import type { IconName } from './AppIcon.vue'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useFocus } from '../focus/index.ts'
import AppIcon from './AppIcon.vue'
import FocusSection from './FocusSection.vue'

export type RailItemId = 'search' | 'home' | 'movies' | 'series' | 'about'

const props = defineProps<{
  current: RailItemId
  // У каждого экрана своя секция рейла: KeepAlive держит несколько экранов сразу
  section: string
  // Секция контента экрана: вправо из рейла и OK на текущем пункте ведут туда
  content?: string
}>()

interface RailItem {
  id: RailItemId
  icon: IconName
  label: string
  path: string
}

const { t } = useI18n()
const router = useRouter()
const focus = useFocus()
const root = ref<HTMLElement>()
const open = ref(false)

const main = computed<RailItem[]>(() => [
  { id: 'search', icon: 'search', label: t('nav.search'), path: '/search' },
  { id: 'home', icon: 'home', label: t('nav.home'), path: '/' },
  { id: 'movies', icon: 'movies', label: t('nav.movies'), path: '/movies' },
  { id: 'series', icon: 'series', label: t('nav.series'), path: '/series' },
])

const about = computed<RailItem>(() => ({
  id: 'about',
  icon: 'about',
  label: t('common.about'),
  path: '/about',
}))

function select(item: RailItem) {
  if (item.id !== props.current)
    router.push(item.path)
  else if (props.content)
    focus.activate(props.content)
}

// Раскрывается только от пульта и клавиатуры: под указкой раскрытый рейл
// перекрыл бы контент и расширил зону под курсором, и закрыть его было бы нельзя
const stopFocus = focus.onFocus((el, via) => {
  open.value = via === 'nav' && !!root.value?.contains(el)
})

// DOM-фокус ушёл мимо движка (клик в поле ввода)
function onFocusout(event: FocusEvent) {
  const next = event.relatedTarget

  if (!(next instanceof Node) || !root.value?.contains(next))
    open.value = false
}

onBeforeUnmount(stopFocus)
</script>

<template>
  <!-- Рейл раскрывается поверх контента: ширина контента не меняется -->
  <nav
    ref="root"
    class="rail"
    :class="{ 'rail--open': open }"
    :aria-label="t('nav.label')"
    @focusout="onFocusout"
  >
    <div class="rail__scrim" />
    <FocusSection
      :name="section"
      :edges="content ? { right: content } : undefined"
      :wheel-target="content"
      class="rail__items"
    >
      <div class="rail__brand">
        <AppIcon name="brand" />
        <span class="rail__label rail__label--brand">Torsher</span>
      </div>
      <button
        v-for="item in main"
        :key="item.id"
        v-focusable
        class="rail__item"
        :class="{ 'rail__item--current': item.id === current }"
        type="button"
        @click="select(item)"
      >
        <AppIcon :name="item.icon" />
        <span class="rail__label">{{ item.label }}</span>
      </button>
      <div class="rail__spacer" />
      <button
        v-focusable
        class="rail__item"
        :class="{ 'rail__item--current': about.id === current }"
        type="button"
        @click="select(about)"
      >
        <AppIcon :name="about.icon" />
        <span class="rail__label">{{ about.label }}</span>
      </button>
    </FocusSection>
  </nav>
</template>

<style scoped>
.rail {
  position: fixed;
  z-index: 30;
  top: 0;
  bottom: 0;
  left: 0;
  width: calc(var(--u) * 460);
  pointer-events: none;
}

.rail__scrim {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: linear-gradient(90deg, rgba(11, 13, 18, 0.98) 0%, rgba(11, 13, 18, 0.92) 50%, rgba(11, 13, 18, 0) 100%);
  opacity: 0;
  transition: opacity var(--motion-base) var(--motion-easing);
}

.rail--open .rail__scrim {
  opacity: 1;
}

.rail__items {
  position: relative;
  display: flex;
  flex-direction: column;
  width: var(--rail-width);
  height: 100%;
  padding: var(--safe-y) 0 var(--safe-y) calc(var(--u) * 28);
  pointer-events: auto;
}

.rail--open .rail__items {
  width: calc(var(--u) * 420);
}

.rail__brand {
  display: flex;
  align-items: center;
  height: calc(var(--u) * 64);
  margin-bottom: calc(var(--u) * 30);
  padding-left: calc(var(--u) * 16);
  color: var(--color-accent);
  font-size: calc(var(--u) * 40);
}

.rail__item {
  position: relative;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  width: calc(var(--u) * 64);
  height: calc(var(--u) * 68);
  margin-bottom: calc(var(--u) * 6);
  padding: 0 0 0 calc(var(--u) * 18);
  border: 0;
  border-radius: calc(var(--u) * 34);
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: calc(var(--u) * 32);
  white-space: nowrap;
}

.rail--open .rail__item {
  width: calc(var(--u) * 340);
}

.rail__item--current,
.rail__item:hover {
  color: var(--color-text);
}

.rail__item--current::before {
  content: '';
  position: absolute;
  top: calc(var(--u) * 22);
  left: calc(var(--u) * -14);
  width: calc(var(--u) * 6);
  height: calc(var(--u) * 24);
  border-radius: calc(var(--u) * 3);
  background: var(--color-accent);
}

.rail__item:focus {
  background: var(--color-focus);
  color: var(--color-bg);
}

.rail__item:focus::before {
  display: none;
}

.rail__label {
  margin-left: calc(var(--u) * 24);
  font-size: var(--font-size-m);
  font-weight: 500;
  opacity: 0;
  transform: translateX(calc(var(--u) * -12));
  transition:
    opacity var(--motion-base) var(--motion-easing),
    transform var(--motion-base) var(--motion-easing);
}

.rail__label--brand {
  margin-left: calc(var(--u) * 18);
  color: var(--color-text);
  font-size: calc(var(--u) * 30);
  font-weight: 700;
}

.rail--open .rail__label {
  opacity: 1;
  transform: none;
}

.rail__spacer {
  flex-grow: 1;
}
</style>
