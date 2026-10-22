<script setup lang="ts">
import type { Profile, ProfileList } from '@torsher/api-client'
import type { LoadError } from '../lib/loadError.ts'
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { loadErrorOf } from '../api.ts'
import AppIcon from '../components/AppIcon.vue'
import AppLoader from '../components/AppLoader.vue'
import FocusSection from '../components/FocusSection.vue'
import PinPad from '../components/PinPad.vue'
import ProfileAvatar from '../components/ProfileAvatar.vue'
import ScreenState from '../components/ScreenState.vue'
import { useHeldLoading } from '../composables/useHeldLoading.ts'
import { useFocus } from '../focus/index.ts'
import { safeNext } from '../lib/session.ts'
import {
  chooseProfile,
  loadProfiles,
  session,
  settleSession,
} from '../session.ts'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const focus = useFocus()

const MAX_COLUMNS = 6

const status = ref<'loading' | 'ready' | 'error'>('loading')
const loadError = ref<LoadError>('unknown')
const list = shallowRef<ProfileList>()
const pinFor = shallowRef<Profile>()
const selectFailed = ref(false)
const grid = ref<HTMLElement>()

const loading = useHeldLoading(() => status.value === 'loading')
const columns = computed(() =>
  Math.min(list.value?.items.length ?? 1, MAX_COLUMNS),
)

/**
 * Дальше — туда, куда шли до выбора, иначе на главную. Запись встаёт без
 * «назад»: Back после смены профиля не возвращает к экранам прежнего зрителя.
 */
function leave() {
  void router.replace({
    path: safeNext(route.query.next) ?? '/',
    state: { back: null },
  })
}

function focusCurrent() {
  const current = session.profile?.id
  const tile = current
    ? grid.value?.querySelector<HTMLElement>(`[data-profile="${current}"]`)
    : null

  if (tile)
    focus.focusOn(tile)
  else focus.activate('profiles-grid')
}

async function load() {
  status.value = 'loading'

  try {
    const value = await loadProfiles()

    // Устройство отключили: экран кода, `next` идёт с ним
    if (!value) {
      void router.replace({ path: '/connect', query: route.query })
      return
    }

    // Экран открыт гейтом после ошибки сервера: выбор мог и не понадобиться
    if (session.status !== 'ready' && (await settleSession(value))) {
      leave()
      return
    }

    list.value = value
    status.value = 'ready'
  }
  catch (err) {
    loadError.value = loadErrorOf(err)
    status.value = 'error'
  }
}

async function select(profile: Profile) {
  selectFailed.value = false

  // Тот же профиль из меню: PIN уже вводили, просто назад к просмотру
  if (session.status === 'ready' && profile.id === session.profile?.id) {
    leave()
    return
  }

  if (profile.hasPin) {
    pinFor.value = profile
    return
  }

  try {
    await chooseProfile(profile.id)
    leave()
  }
  catch {
    selectFailed.value = true
  }
}

async function closePin() {
  pinFor.value = undefined
  await nextTick()
  focus.activate('profiles-grid')
}

// Сетка или ошибка появляются, когда ушёл лоадер
const shown = computed(() => (loading.value ? 'loading' : status.value))

// Фокус — после следующего тика: `v-focusable` регистрирует элементы в
// mounted, а он идёт уже после рендера экрана
watch(shown, async (value) => {
  await nextTick()

  if (value === 'ready')
    focusCurrent()
  else if (value === 'error')
    focus.activate('profiles-state')
})

void load()
</script>

<template>
  <main class="profiles">
    <PinPad v-if="pinFor" :profile="pinFor" @cancel="closePin" @done="leave" />

    <!-- Сетка остаётся в DOM под PIN: после «Отмены» фокус вернётся на тот же профиль -->
    <div v-show="!pinFor" class="profiles__choose">
      <h1 class="profiles__title">
        {{ t("profiles.title") }}
      </h1>

      <div v-if="shown === 'loading'" class="profiles__loader">
        <AppLoader />
      </div>

      <FocusSection v-else-if="shown === 'error'" name="profiles-state">
        <ScreenState :kind="loadError" @retry="load" />
      </FocusSection>

      <FocusSection v-else-if="list" name="profiles-grid">
        <div
          ref="grid"
          class="profiles__grid"
          :style="{ '--columns': columns }"
        >
          <button
            v-for="profile in list.items"
            :key="profile.id"
            v-focusable
            class="card profile"
            type="button"
            :data-profile="profile.id"
            :aria-label="
              profile.hasPin
                ? `${profile.name}, ${t('profiles.locked')}`
                : profile.name
            "
            @click="select(profile)"
          >
            <span class="profile__frame">
              <ProfileAvatar :profile="profile" class="profile__avatar" />
              <span v-if="profile.hasPin" class="profile__lock">
                <AppIcon name="lock" />
              </span>
              <span class="card__ring" />
            </span>
            <span class="profile__name">{{ profile.name }}</span>
          </button>
        </div>
      </FocusSection>

      <p class="profiles__message" aria-live="polite">
        {{ selectFailed ? t("state.unknown.text") : "" }}
      </p>
    </div>
  </main>
</template>

<style scoped>
.profiles {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--safe-y) var(--safe-x);
}

.profiles__choose {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.profiles__title {
  margin: 0 0 var(--space-6);
  font-size: var(--font-size-xl);
}

/* Лоадер на месте одного ряда аватаров: появилась сетка — экран не прыгает */
.profiles__loader {
  display: flex;
  align-items: center;
  justify-content: center;
  height: calc(var(--u) * 268);
}

.profiles__grid {
  display: grid;
  grid-template-columns: repeat(var(--columns), calc(var(--u) * 200));
  grid-gap: var(--space-5) calc(var(--u) * 56);
  justify-content: center;
}

.profile {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
}

.profile:focus {
  color: var(--color-text);
}

.profile__frame {
  position: relative;
  display: block;
  width: calc(var(--u) * 200);
  height: calc(var(--u) * 200);
}

.profile__avatar {
  width: 100%;
  height: 100%;
  border-radius: var(--radius-l);
  font-size: calc(var(--u) * 88);
}

.profile .card__ring {
  border-radius: calc(var(--radius-l) + var(--u) * 8);
}

.profile__lock {
  position: absolute;
  right: calc(var(--u) * 12);
  bottom: calc(var(--u) * 12);
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--u) * 48);
  height: calc(var(--u) * 48);
  border-radius: 50%;
  background: rgba(11, 13, 18, 0.55);
  color: #fff;
  font-size: calc(var(--u) * 26);
}

.profile__name {
  max-width: 100%;
  margin-top: var(--space-3);
  overflow: hidden;
  font-size: var(--font-size-m);
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
  transition: color var(--motion-fast) var(--motion-easing);
}

.profiles__message {
  height: calc(var(--font-size-s) * var(--line-height));
  margin: var(--space-5) 0 0;
  color: var(--color-bad);
  font-size: var(--font-size-s);
}
</style>
