<script setup lang="ts">
import type { PinErrorResponse, Profile } from '@torsher/api-client'
import { getErrorBody, getErrorStatus } from '@torsher/api-client'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFocus } from '../focus/index.ts'
import { minutesLeft, PIN_LENGTH, popDigit, pushDigit } from '../lib/pin.ts'
import { chooseProfile } from '../session.ts'
import FocusSection from './FocusSection.vue'
import ProfileAvatar from './ProfileAvatar.vue'

const props = defineProps<{ profile: Profile }>()

const emit = defineEmits<{
  cancel: []
  done: []
}>()

type PinError
  = | { kind: 'wrong', attemptsLeft: number }
    | { kind: 'locked', until: number }
    | { kind: 'failed' }

const { t } = useI18n()
const focus = useFocus()

const pin = ref('')
const error = ref<PinError>()
const busy = ref(false)
// Счётчик неверных попыток: новый ключ ячеек заново запускает встряску
const wrongCount = ref(0)
const now = ref(Date.now())
const cancelButton = ref<HTMLElement>()

const KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

const locked = computed(
  () => error.value?.kind === 'locked' && error.value.until > now.value,
)

const message = computed(() => {
  const value = error.value

  if (!value)
    return ''

  if (value.kind === 'wrong')
    return t('profiles.pin.wrong', value.attemptsLeft)

  if (value.kind === 'locked') {
    return locked.value
      ? t('profiles.pin.locked', { n: minutesLeft(value.until, now.value) })
      : ''
  }

  return t('profiles.pin.error')
})

// Пока профиль закрыт, минуты до конца блокировки идут на экране
let clock = 0

watch(locked, async (value) => {
  clearInterval(clock)

  if (!value)
    return

  clock = window.setInterval(() => {
    now.value = Date.now()
  }, 1000)

  // Цифры не нажимаются: фокус — на единственное, что сейчас работает
  await nextTick()

  if (cancelButton.value)
    focus.focusOn(cancelButton.value)
})

async function submit() {
  busy.value = true

  try {
    await chooseProfile(props.profile.id, pin.value)
    emit('done')
  }
  catch (err) {
    const status = getErrorStatus(err)
    const body = await getErrorBody<Partial<PinErrorResponse>>(err)

    if (status === 403 && body?.kind === 'wrong_pin') {
      error.value = { kind: 'wrong', attemptsLeft: body.attemptsLeft ?? 0 }
      wrongCount.value++
    }
    else if (status === 429 && body?.retryAfter) {
      now.value = Date.now()
      error.value = {
        kind: 'locked',
        until: now.value + body.retryAfter * 1000,
      }
      wrongCount.value++
    }
    else {
      error.value = { kind: 'failed' }
    }

    pin.value = ''
  }
  finally {
    busy.value = false
  }
}

function press(digit: number) {
  if (busy.value || locked.value)
    return

  // Новый набор после ошибки: прежнее сообщение больше не про него
  if (!pin.value)
    error.value = undefined

  pin.value = pushDigit(pin.value, digit)

  if (pin.value.length === PIN_LENGTH)
    void submit()
}

function erase() {
  if (!busy.value)
    pin.value = popDigit(pin.value)
}

// Цифры пульта и клавиатуры набирают PIN; Back стирает цифру, без цифр — выход
const stopKey = focus.onKey((action) => {
  if (action.type === 'digit') {
    press(action.digit)
    return true
  }

  if (action.type === 'back') {
    if (pin.value)
      erase()
    else emit('cancel')

    return true
  }

  return false
})

onBeforeUnmount(() => {
  stopKey()
  clearInterval(clock)
})
</script>

<template>
  <div class="pin">
    <ProfileAvatar :profile="profile" class="pin__avatar" />
    <h1 class="pin__title">
      {{ t("profiles.pin.title", { name: profile.name }) }}
    </h1>

    <div
      :key="wrongCount"
      class="pin__cells"
      :class="{ 'pin__cells--wrong': wrongCount > 0 }"
      role="img"
      :aria-label="t('profiles.pin.digits', { n: pin.length })"
    >
      <span
        v-for="index in PIN_LENGTH"
        :key="index"
        class="pin__cell"
        :class="{ 'pin__cell--filled': index <= pin.length }"
      />
    </div>

    <!-- Строка сообщения занимает место всегда: клавиатура под ней не прыгает -->
    <p class="pin__message" aria-live="polite">
      {{ message }}
    </p>

    <FocusSection
      name="pin-keys"
      autofocus
      class="pin__keys"
      :class="{ 'pin__keys--locked': locked }"
    >
      <button
        v-for="digit in KEYS"
        :key="digit"
        v-focusable
        class="action pin__key"
        type="button"
        @click="press(digit)"
      >
        {{ digit }}
      </button>
      <button
        ref="cancelButton"
        v-focusable
        class="action pin__key pin__key--word pin__key--cancel"
        type="button"
        @click="emit('cancel')"
      >
        {{ t("profiles.pin.cancel") }}
      </button>
      <button
        v-focusable
        class="action pin__key"
        type="button"
        @click="press(0)"
      >
        0
      </button>
      <button
        v-focusable
        class="action pin__key pin__key--word"
        type="button"
        @click="erase"
      >
        {{ t("profiles.pin.erase") }}
      </button>
    </FocusSection>
  </div>
</template>

<style scoped>
.pin {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.pin__avatar {
  width: calc(var(--u) * 140);
  height: calc(var(--u) * 140);
  margin-bottom: var(--space-3);
  border-radius: var(--radius-l);
  font-size: calc(var(--u) * 64);
}

.pin__title {
  margin: 0 0 var(--space-5);
  font-size: var(--font-size-l);
  font-weight: 600;
}

.pin__cells {
  display: flex;
}

.pin__cells--wrong {
  animation: pin-shake 360ms var(--motion-easing);
}

.pin__cell {
  position: relative;
  width: calc(var(--u) * 72);
  height: calc(var(--u) * 72);
  margin: 0 calc(var(--u) * 12);
  border: calc(var(--u) * 3) solid var(--color-line);
  border-radius: var(--radius-m);
  background: var(--color-surface);
}

/* Точка вместо цифры: PIN видят все, кто сидит у телевизора */
.pin__cell::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: calc(var(--u) * 24);
  height: calc(var(--u) * 24);
  margin: calc(var(--u) * -12) 0 0 calc(var(--u) * -12);
  border-radius: 50%;
  background: var(--color-text);
  opacity: 0;
  transform: scale(0.4);
  transition:
    opacity var(--motion-fast) var(--motion-easing),
    transform var(--motion-fast) var(--motion-easing);
}

.pin__cell--filled::after {
  opacity: 1;
  transform: scale(1);
}

.pin__message {
  height: calc(var(--font-size-s) * var(--line-height));
  margin: var(--space-3) 0 var(--space-4);
  color: var(--color-bad);
  font-size: var(--font-size-s);
}

.pin__keys {
  display: grid;
  grid-template-columns: repeat(3, calc(var(--u) * 180));
  grid-auto-rows: calc(var(--u) * 92);
  grid-gap: calc(var(--u) * 20);
}

/* Профиль закрыт после неверных попыток: цифры видны, но не нажимаются; «Отмена» работает */
.pin__keys--locked .pin__key:not(.pin__key--cancel) {
  opacity: 0.4;
}

.pin__key {
  justify-content: center;
  transition:
    transform var(--motion-base) var(--motion-easing),
    background-color var(--motion-fast) var(--motion-easing),
    color var(--motion-fast) var(--motion-easing),
    opacity var(--motion-base) var(--motion-easing);
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  font-size: var(--font-size-l);
}

.pin__key--word {
  font-size: var(--font-size-s);
}

@keyframes pin-shake {
  20%,
  60% {
    transform: translateX(calc(var(--u) * -14));
  }

  40%,
  80% {
    transform: translateX(calc(var(--u) * 14));
  }
}
</style>
