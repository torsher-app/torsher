<script setup lang="ts">
import type { PersonCredit, PersonDetails } from '@torsher/api-client'
import type { SectionEdges } from '../focus/index.ts'
import type { ComponentPublicInstance } from 'vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import ActionButton from '../components/ActionButton.vue'
import AppIcon from '../components/AppIcon.vue'
import ContentRow from '../components/ContentRow.vue'
import FocusSection from '../components/FocusSection.vue'
import PosterCard from '../components/PosterCard.vue'
import PosterSkeleton from '../components/PosterSkeleton.vue'
import ScreenState from '../components/ScreenState.vue'
import SidePanel from '../components/SidePanel.vue'
import { sectionName, useBlockStack } from '../composables/useBlockStack.ts'
import { useCatalogLanguage } from '../composables/useCatalogLanguage.ts'
import { useCatalogPerson } from '../composables/useCatalogPerson.ts'
import { useHeldLoading } from '../composables/useHeldLoading.ts'
import { useStackedScreen } from '../composables/useStackedScreen.ts'
import { useFocus } from '../focus/index.ts'
import { goBack } from '../lib/navigation.ts'
import { ageOf, rolesLine } from '../lib/people.ts'
import { formatPublishDate } from '../lib/titleInfo.ts'

const props = defineProps<{ id: string }>()

type Role = PersonDetails['credits'][number]['role']

// В шапке — не больше трёх ролей: остальные видны рядами ниже
const MAX_HEAD_ROLES = 3

const { t } = useI18n()
const router = useRouter()
const focus = useFocus()
const language = useCatalogLanguage()

const id = computed(() => props.id)
const { person, status, error, retry } = useCatalogPerson(id)
// Проявившийся скелетон держится минимум: экран и фокус ждут его
const showSkeleton = useHeldLoading(() => status.value === 'loading')
const shownPerson = computed(() =>
  showSkeleton.value ? undefined : person.value,
)

const credits = computed(() => person.value?.credits ?? [])

const roles = computed(() =>
  rolesLine(
    credits.value.slice(0, MAX_HEAD_ROLES).map(group => group.role),
    t,
  ),
)

// «30 июля 1970 · 56 лет · Лондон», у умершего — даты жизни и возраст на дату смерти
const life = computed(() => {
  const value = person.value

  if (!value)
    return ''

  const parts: string[] = []

  if (value.birthday) {
    const born = formatPublishDate(value.birthday, language.value)

    parts.push(
      value.deathday
        ? t('person.lifespan', {
            born,
            died: formatPublishDate(value.deathday, language.value),
          })
        : born,
    )

    const age = ageOf(value.birthday, value.deathday)

    if (age !== undefined)
      parts.push(t('person.age', age))
  }

  if (value.placeOfBirth)
    parts.push(value.placeOfBirth)

  return parts.filter(Boolean).join(' · ')
})

// Фото не загрузилось — инициалы, как у карточки человека
const photoFailed = ref(false)

const initials = computed(() =>
  (person.value?.name ?? '')
    .split(/\s+/)
    .slice(0, 2)
    .map(word => word.charAt(0))
    .join('')
    .toUpperCase(),
)

function rowSection(role: Role) {
  return `person-role-${role}`
}

/*
 * Секции сверху вниз: кнопка «Биография» и ряды ролей. Все — manual-scroll:
 * экран сам ставит блок на место (transform).
 */
const order = computed(() => {
  if (status.value === 'error')
    return ['person-state']

  const list: string[] = []

  if (person.value?.biography)
    list.push('person-actions')

  for (const group of credits.value) list.push(rowSection(group.role))

  return list
})

function edgesOf(name: string): SectionEdges {
  const index = order.value.indexOf(name)

  return {
    up: index > 0 ? order.value[index - 1] : 'person-back',
    down: order.value[index + 1],
  }
}

const bioOpen = ref(false)
const stack = ref<HTMLElement>()
const screen = ref<HTMLElement>()
const { active } = useStackedScreen(screen, {
  fallback: () => order.value[0],
})
const {
  native: nativeScroll,
  transform: stackTransform,
  onScroll: onScreenScroll,
  blocksAbove,
  align,
} = useBlockStack({
  screen,
  stack,
  order,
  active,
  wheelHeld: () => bioOpen.value,
})

const stopFocus = focus.onFocus((el, via) => {
  if (!screen.value?.contains(el) || via === 'pointer')
    return

  align(el, sectionName(el))
})

// Данные пришли: фокус на первую секцию, если зритель ещё на этом экране
watch(shownPerson, async (value) => {
  if (!value)
    return

  await nextTick()

  const current = focus.current()

  if (active.value && !(current && screen.value?.contains(current)))
    focus.activate(order.value[0] ?? 'person-back')
})

// Тайтл под фокусом в каждом ряду: под рядом — его год, название и роль
const focusedCredit = ref<Partial<Record<Role, number>>>({})

function onCreditFocus(role: Role, index: number) {
  focusedCredit.value = { ...focusedCredit.value, [role]: index }
}

function creditLine(role: Role, items: PersonCredit[]) {
  const item = items[focusedCredit.value[role] ?? 0]

  if (!item)
    return ''

  return [item.year, item.title, item.detail].filter(Boolean).join(' · ')
}

function creditKey(item: PersonCredit) {
  return item.id
}

function openTitle(item: PersonCredit) {
  router.push(`/title/${item.id}`)
}

// Полный текст биографии — правая панель: стрелки листают текст, Back закрывает
const bioButton = ref<ComponentPublicInstance>()
const bioText = ref<HTMLElement>()
// Доля высоты текста на одно нажатие стрелки
const BIO_STEP = 0.4

let stopBioKeys: (() => void) | undefined

function openBio() {
  bioOpen.value = true
  stopBioKeys = focus.onKey((action) => {
    if (action.type !== 'move' || !bioText.value)
      return false

    if (action.direction === 'up' || action.direction === 'down') {
      const step = bioText.value.clientHeight * BIO_STEP

      bioText.value.scrollBy({
        top: action.direction === 'down' ? step : -step,
        behavior: 'smooth',
      })
    }

    return true
  })
}

function closeBio() {
  stopBioKeys?.()
  stopBioKeys = undefined
  bioOpen.value = false
  nextTick(() => {
    if (bioButton.value)
      focus.focusOn(bioButton.value.$el)
  })
}

function back() {
  goBack(router)
}

onBeforeUnmount(() => {
  stopFocus()
  stopBioKeys?.()
})
</script>

<template>
  <main
    ref="screen"
    class="person"
    :class="{ 'person--native': nativeScroll }"
    @scroll="onScreenScroll"
  >
    <FocusSection name="person-back" :edges="{ down: order[0] }">
      <button v-focusable class="screen-back" type="button" @click="back">
        <AppIcon name="chevronLeft" />
        <span class="screen-back__label">{{ t("common.back") }}</span>
      </button>
    </FocusSection>

    <FocusSection
      v-if="status === 'error' && error && !showSkeleton"
      name="person-state"
      class="person__state"
      :edges="{ up: 'person-back' }"
      autofocus
    >
      <ScreenState :kind="error" @retry="retry" />
    </FocusSection>

    <div
      v-else-if="person && !showSkeleton"
      ref="stack"
      class="person__stack"
      :style="{ transform: stackTransform }"
    >
      <section
        class="person__head"
        :class="{ 'block--above': blocksAbove.includes('head') }"
        data-block="head"
      >
        <div class="person__photo">
          <img
            v-if="person.photo && !photoFailed"
            class="person__photo-image"
            :src="person.photo"
            alt=""
            decoding="async"
            @error="photoFailed = true"
          >
          <span v-else class="person__initials">{{ initials }}</span>
        </div>

        <div class="person__info">
          <h1 class="person__name">
            {{ person.name }}
          </h1>
          <p v-if="roles" class="person__line">
            {{ roles }}
          </p>
          <p v-if="life" class="person__line">
            {{ life }}
          </p>
          <p v-if="person.biography" class="person__bio">
            {{ person.biography }}
          </p>

          <FocusSection
            v-if="person.biography"
            name="person-actions"
            manual-scroll
            class="person__actions"
            :edges="edgesOf('person-actions')"
          >
            <ActionButton
              ref="bioButton"
              v-focusable
              :label="t('person.biography')"
              @click="openBio"
            />
          </FocusSection>
        </div>
      </section>

      <p v-if="credits.length === 0" class="person__empty">
        {{ t("person.empty") }}
      </p>

      <section
        v-for="group in credits"
        :key="group.role"
        class="block"
        :class="{ 'block--above': blocksAbove.includes(group.role) }"
        :data-block="group.role"
      >
        <ContentRow
          :section="rowSection(group.role)"
          :title="
            t('person.roleTitle', {
              role: t(`person.roles.${group.role}`),
              n: group.total,
            })
          "
          :items="group.items"
          :item-key="creditKey"
          :edges="edgesOf(rowSection(group.role))"
          @focus-item="(index) => onCreditFocus(group.role, index)"
        >
          <template #item="{ item }">
            <PosterCard
              :card="item"
              :watched="item.watched"
              @select="openTitle(item)"
            />
          </template>
        </ContentRow>
        <!-- Одна строка постоянной высоты: шаг по ряду не сдвигает блоки ниже -->
        <p class="person__credit">
          {{ creditLine(group.role, group.items) }}
        </p>
      </section>
    </div>

    <div v-else class="person__stack" aria-hidden="true">
      <div class="person__head">
        <div class="person__photo skeleton" />
        <div class="person__info">
          <div class="skeleton-line skeleton-line--name skeleton" />
          <div class="skeleton-line skeleton" />
          <div class="skeleton-line skeleton-line--wide skeleton" />
          <div class="skeleton-line skeleton-line--wide skeleton" />
        </div>
      </div>
      <div class="person__skeleton-row">
        <PosterSkeleton
          v-for="index in 7"
          :key="index"
          class="person__skeleton-poster"
          :caption="false"
        />
      </div>
    </div>

    <SidePanel
      v-if="bioOpen && person"
      :title="t('person.biography')"
      @close="closeBio"
    >
      <FocusSection name="person-bio" class="person__bio-panel" autofocus>
        <div ref="bioText" v-focusable class="person__bio-full" tabindex="-1">
          {{ person.biography }}
        </div>
      </FocusSection>
    </SidePanel>
  </main>
</template>

<style scoped>
/* Свой полноэкранный экран, как карточка тайтла: блоки едут transform */
.person {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
  background: var(--color-bg);
}

/* Веб: экран прокручивается нативно, полоса прокрутки не нужна */
.person--native {
  overflow-y: auto;
}

.person--native::-webkit-scrollbar {
  display: none;
}

.person__state {
  position: relative;
  padding: calc(var(--u) * 132) var(--safe-x) 0 var(--content-x);
}

.person__stack {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  padding-bottom: calc(var(--u) * 260);
  transition: transform var(--motion-base) var(--motion-easing);
}

.person__head,
.block {
  transition: opacity var(--motion-base) var(--motion-easing);
  will-change: opacity;
}

.block--above {
  opacity: 0;
  pointer-events: none;
}

/* Высота постоянная: от неё считается положение рядов. Первый ряд на первом
   экране помещается вместе с кольцом фокуса: наведение экран не прокручивает */
.person__head {
  position: relative;
  display: flex;
  height: calc(var(--u) * 640);
  padding: calc(var(--u) * 132) var(--safe-x) 0 var(--content-x);
  box-sizing: border-box;
}

/* aspect-ratio появился в Chromium 88: высота задана явно, 2:3 */
.person__photo {
  position: relative;
  flex-shrink: 0;
  width: calc(var(--u) * 300);
  height: calc(var(--u) * 450);
  margin-right: calc(var(--u) * 56);
  overflow: hidden;
  border-radius: var(--radius-m);
  background: var(--color-surface-raised);
}

/* Фон скелетона мерцает слоем под элементом: свой фон рамки его закрыл бы */
.person__photo.skeleton {
  background: none;
}

.person__photo-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.person__initials {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-muted);
  font-size: calc(var(--u) * 96);
  font-weight: 600;
}

/* Колонка высотой с фото: кнопка «Биография» стоит на одном месте у любой персоны */
.person__info {
  position: relative;
  flex: 1;
  min-width: 0;
  max-width: calc(var(--u) * 1100);
  height: calc(var(--u) * 450);
}

.person__name {
  margin: 0 0 calc(var(--u) * 18);
  overflow: hidden;
  font-size: var(--font-size-xl);
  line-height: 1.05;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.person__line {
  margin: 0 0 calc(var(--u) * 10);
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* -webkit-line-clamp работает и в Chromium 68 */
.person__bio {
  display: -webkit-box;
  max-width: calc(var(--u) * 1000);
  margin: calc(var(--u) * 20) 0 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-m);
  line-height: 1.42;
  white-space: pre-line;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
}

.person__actions {
  position: absolute;
  bottom: 0;
  left: 0;
  display: flex;
}

.person__empty {
  margin: 0;
  padding: 0 var(--safe-x) 0 var(--content-x);
  color: var(--color-text-muted);
  font-size: var(--font-size-m);
}

.block {
  position: relative;
  margin-bottom: calc(var(--u) * 24);
}

.person__credit {
  height: calc(var(--font-size-s) * var(--line-height));
  margin: calc(var(--u) * -28) 0 0;
  padding: 0 var(--safe-x) 0 var(--content-x);
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.person__skeleton-row {
  display: flex;
  padding-left: var(--content-x);
  overflow: hidden;
}

.person__skeleton-poster {
  margin-right: calc(var(--u) * 28);
}

.person__bio-panel {
  flex: 1;
  min-height: 0;
  display: flex;
}

/* Текст листается стрелками и колесом; единственный элемент панели — без кольца */
.person__bio-full {
  flex: 1;
  padding-bottom: var(--safe-y);
  overflow-y: auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-m);
  line-height: 1.5;
  white-space: pre-line;
  outline: none;
}

.person__bio-full::-webkit-scrollbar {
  display: none;
}

.skeleton-line {
  width: calc(var(--u) * 400);
  height: var(--font-size-m);
  margin-bottom: var(--space-3);
  border-radius: var(--radius-s);
}

.skeleton-line--name {
  width: calc(var(--u) * 600);
  height: var(--font-size-xl);
}

.skeleton-line--wide {
  width: calc(var(--u) * 900);
}
</style>
