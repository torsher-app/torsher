<script setup lang="ts">
import type { IconName } from './AppIcon.vue'
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useFocus } from '../focus/index.ts'
import { session } from '../session.ts'
import AppIcon from './AppIcon.vue'
import FocusSection from './FocusSection.vue'
import ProfileAvatar from './ProfileAvatar.vue'

export type RailItemId
  = | 'search'
    | 'home'
    | 'movies'
    | 'series'
    | 'catalog'
    | 'mine'
    | 'library'
    | 'settings'
    | 'about'

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
  { id: 'catalog', icon: 'catalog', label: t('nav.catalog'), path: '/catalog' },
  { id: 'mine', icon: 'mine', label: t('nav.mine'), path: '/mine' },
  {
    id: 'library',
    icon: 'library',
    label: t('nav.library'),
    path: '/library',
  },
])

// Внизу, под профилем: настройки этого устройства и «О программе»
const bottom = computed<RailItem[]>(() => [
  {
    id: 'settings',
    icon: 'settings',
    label: t('nav.settings'),
    path: '/settings',
  },
  { id: 'about', icon: 'about', label: t('common.about'), path: '/about' },
])

// Разделы переключаются заменой записи, как вкладки: история не копится, и
// Back с любого раздела ведёт на главную, а не по кругу через прошлые разделы.
// «Вперёд» от прежнего раздела к новому не относится
function select(item: RailItem) {
  if (item.id !== props.current)
    void router.replace({ path: item.path, state: { forward: null } })
  else if (props.content)
    focus.activate(props.content)
}

// Фокус уже в рейле: шаги внутри него — не вход
let inside = false

// Раскрывается только от пульта и клавиатуры: под указкой раскрытый рейл
// перекрыл бы контент и расширил зону под курсором, и закрыть его было бы нельзя
const stopFocus = focus.onFocus((el, via) => {
  const within = !!root.value?.contains(el)
  const entered = within && !inside

  inside = within
  open.value = via === 'nav' && within

  if (open.value)
    void nextTick(() => markClipped(el))

  // Вход в рейл с пульта — на текущий раздел, как в Google TV и Netflix,
  // а не на запомненный или первый пункт
  if (entered && via === 'nav') {
    const current = root.value?.querySelector<HTMLElement>(
      '.rail__item--current',
    )

    if (current && current !== el)
      focus.focusOn(current, via)
  }
})

// Подпись длиннее плашки (длинная локаль, имя профиля) обрезана многоточием,
// полный текст — подписью справа. Замер после раскрытия: в свёрнутом рейле
// подписи нулевой ширины. `data-clipped`, а не класс: классы пунктов ведёт Vue
function markClipped(el: HTMLElement) {
  const label = el.querySelector<HTMLElement>('.rail__label')

  if (label && label.scrollWidth > label.clientWidth)
    el.dataset.clipped = ''
  else delete el.dataset.clipped
}

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
        <span class="focus-caption rail__caption" aria-hidden="true">{{
          item.label
        }}</span>
      </button>
      <div class="rail__spacer" />
      <!-- «Сменить профиль»: аватар и имя зрителя, OK — экран выбора -->
      <button
        v-if="session.profile"
        v-focusable
        class="rail__item"
        type="button"
        :aria-label="t('profiles.switch')"
        @click="router.push('/profiles')"
      >
        <ProfileAvatar :profile="session.profile" class="rail__avatar" />
        <span class="rail__label">{{ session.profile.name }}</span>
        <span class="focus-caption rail__caption" aria-hidden="true">{{
          session.profile.name
        }}</span>
      </button>
      <button
        v-for="item in bottom"
        :key="item.id"
        v-focusable
        class="rail__item"
        :class="{ 'rail__item--current': item.id === current }"
        type="button"
        @click="select(item)"
      >
        <AppIcon :name="item.icon" />
        <span class="rail__label">{{ item.label }}</span>
        <span class="focus-caption rail__caption" aria-hidden="true">{{
          item.label
        }}</span>
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

/*
 * Ось рейла — центр круга пункта (28 + 64 / 2 = 60 px макета, там же центр
 * «Назад» полноэкранных экранов). Иконка, аватар и знак встают на неё отступом
 * (круг − знак) / 2 от левого края пункта: свои числа под отступ разъезжаются
 * с кругом, как только меняется размер чего-то одного
 */
.rail__items {
  --rail-circle: calc(var(--u) * 64);
  --rail-mark: calc(var(--u) * 32);
  --rail-brand: calc(var(--u) * 40);

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
  height: var(--rail-circle);
  margin-bottom: calc(var(--u) * 30);
  /* Абажур и ножка стоят по центру viewBox, шнурок справа — за осью */
  padding-left: calc((var(--rail-circle) - var(--rail-brand)) / 2);
  color: var(--color-accent);
  font-size: var(--rail-brand);
}

.rail__item {
  position: relative;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  width: var(--rail-circle);
  height: var(--rail-circle);
  margin-bottom: calc(var(--u) * 10);
  padding: 0 0 0 calc((var(--rail-circle) - var(--rail-mark)) / 2);
  border: 0;
  border-radius: calc(var(--rail-circle) / 2);
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--rail-mark);
  white-space: nowrap;
}

/* Справа поле: обрезанная подпись кончается многоточием внутри плашки */
.rail--open .rail__item {
  width: calc(var(--u) * 340);
  padding-right: calc(var(--u) * 24);
}

.rail__item--current {
  color: var(--color-text);
}

.rail__item--current::before {
  content: '';
  position: absolute;
  top: calc((var(--rail-circle) - var(--u) * 24) / 2);
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
  min-width: 0;
  margin-left: calc(var(--u) * 24);
  overflow: hidden;
  font-size: var(--font-size-m);
  text-overflow: ellipsis;
  font-weight: 500;
  opacity: 0;
  transform: translateX(calc(var(--u) * -12));
  transition:
    opacity var(--motion-base) var(--motion-easing),
    transform var(--motion-base) var(--motion-easing);
}

/* Подпись знака — с той же линии, что подписи пунктов */
.rail__label--brand {
  margin-left: calc(var(--u) * 20);
  color: var(--color-text);
  font-size: calc(var(--u) * 30);
  font-weight: 700;
}

.rail--open .rail__label {
  opacity: 1;
  transform: none;
}

.rail__caption {
  top: 50%;
  left: 100%;
  margin-left: calc(var(--u) * 12);
  transform: translateY(-50%);
}

.rail--open .rail__item[data-clipped]:focus .rail__caption {
  opacity: 1;
}

.rail__spacer {
  flex-grow: 1;
}

/* Аватар на месте иконки: квадрат размером с иконку, буква мельче */
.rail__avatar {
  flex-shrink: 0;
  width: var(--rail-mark);
  height: var(--rail-mark);
  border-radius: calc(var(--u) * 8);
  font-size: calc(var(--u) * 18);
}
</style>
