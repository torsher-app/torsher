<script setup lang="ts" generic="T extends string">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import ActionButton from '../ActionButton.vue'
import ButtonRow from '../ButtonRow.vue'
import FocusSection from '../FocusSection.vue'

// Содержимое сцены плеера (`PlayerStage`): заголовок, текст и действия по центру
const props = defineProps<{
  title?: string
  text?: string
  /** Первое действие получает фокус и выглядит главным */
  actions: { id: T, label: string }[]
  /** Действие выполняется: кнопка приглушена, окно ещё на экране */
  busy?: T
  /** Растёт, когда действие вернуло тот же исход: кнопка коротко трясётся «не вышло» */
  rejections?: number
}>()

const emit = defineEmits<{ choose: [id: T] }>()

const SHAKE_MS = 420
const shaking = ref(false)
let shakeTimer = 0

// Повторный отказ во время тряски начинает её заново: класс снимается на кадр
watch(
  () => props.rejections,
  async () => {
    clearTimeout(shakeTimer)
    shaking.value = false
    await nextTick()
    shaking.value = true
    shakeTimer = window.setTimeout(() => {
      shaking.value = false
    }, SHAKE_MS)
  },
)

onBeforeUnmount(() => clearTimeout(shakeTimer))
</script>

<template>
  <div class="prompt" role="dialog" :aria-label="title ?? text">
    <p v-if="title" class="prompt__title">
      {{ title }}
    </p>
    <p v-if="text" class="prompt__text">
      {{ text }}
    </p>
    <FocusSection
      name="player-prompt"
      class="prompt__actions"
      autofocus
      manual-scroll
    >
      <ButtonRow center>
        <ActionButton
          v-for="(action, index) in actions"
          :key="action.id"
          v-focusable
          :primary="index === 0"
          :label="action.label"
          :class="{
            'prompt__action--busy': action.id === busy,
            'prompt__action--shake': shaking && index === 0,
          }"
          @click="emit('choose', action.id)"
        />
      </ButtonRow>
    </FocusSection>
  </div>
</template>

<style scoped>
.prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: calc(var(--u) * 1100);
}

.prompt__title {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-l);
  font-weight: 700;
}

.prompt__text {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-m);
}

/* Где остановились — та же дорожка, что у серий в карточке и «Файлах» */
.prompt__actions {
  align-self: stretch;
  margin-top: var(--space-4);
}

/* Окно не уходит, пока действие идёт: так быстрый тот же ответ не мигает экраном */
.prompt__action--busy {
  opacity: 0.6;
  transition: opacity var(--motion-fast) var(--motion-easing);
}

/* Масштаб фокуса держит --bump-scale, как у толчка на краю */
.prompt__action--shake {
  animation: prompt-shake 420ms var(--motion-easing);
}

@keyframes prompt-shake {
  20% {
    transform: translateX(calc(var(--u) * -12)) scale(var(--bump-scale));
  }

  45% {
    transform: translateX(calc(var(--u) * 10)) scale(var(--bump-scale));
  }

  70% {
    transform: translateX(calc(var(--u) * -6)) scale(var(--bump-scale));
  }

  90% {
    transform: translateX(calc(var(--u) * 2)) scale(var(--bump-scale));
  }
}

/* Без gap: flex-gap нет в Chromium 68 */
.prompt__actions .action + .action {
  margin-left: var(--space-2);
}
</style>
