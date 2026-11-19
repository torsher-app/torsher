<script setup lang="ts">
import type { MineUndo } from '../../lib/mineUndo.ts'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useFocus } from '../../focus/index.ts'
import { captureTitleActionReturn } from '../../focus/titleActionReturn.ts'
import { mineEditor } from '../../lib/mineEditor.ts'
import { formatMineDate } from '../../lib/mineDates.ts'
import { applyMineUndo, clearMineUndo, mineUndo } from '../../lib/mineUndo.ts'
import { isMineViewer } from '../../lib/minePersonal.ts'
import { titleActions } from '../../titleActions.ts'
import FocusSection from '../FocusSection.vue'

const props = defineProps<{ change: MineUndo }>()
const { t, locale } = useI18n()
const route = useRoute()
const demo = __DEMO__
const focus = useFocus()
const root = ref<HTMLElement>()
const busy = ref(false)
const error = ref(false)
const controller = new AbortController()
const startedPath = route.fullPath
let live = true
let anchor = props.change.opener
let timer: ReturnType<typeof setTimeout> | undefined
const originalScreen = anchor?.closest<HTMLElement>('main')
const restore = captureTitleActionReturn(focus, anchor)

function schedule() {
  clearTimeout(timer)
  if (!live)
    return
  if (!busy.value && !root.value?.contains(focus.current() ?? null))
    timer = setTimeout(clearMineUndo, 8000, props.change)
}

async function returnFocus() {
  const change = props.change
  clearMineUndo(change)
  await nextTick()
  if (
    !isMineViewer(change.context)
    || route.fullPath !== startedPath
    || mineEditor.value
    || titleActions.target
    || mineUndo.value
  ) {
    return
  }
  if (anchor?.isConnected && focus.focusOn(anchor))
    return
  restore()
}

const stopFocus = focus.onFocus((element) => {
  if (root.value?.contains(element)) {
    clearTimeout(timer)
  }
  else {
    if (
      (!anchor || !anchor.isConnected)
      && (!originalScreen || originalScreen.contains(element))
    ) {
      anchor = element
    }
    schedule()
  }
})
const stopKey = focus.onKey((action) => {
  const inside = root.value?.contains(focus.current() ?? null)
  if (
    inside
    && (action.type === 'back'
      || (action.type === 'move' && action.direction === 'up'))
  ) {
    if (!busy.value)
      void returnFocus()
    return true
  }
  if (
    !inside
    && action.type === 'move'
    && action.direction === 'down'
    && anchor?.isConnected
    && focus.current() === anchor
  ) {
    return focus.activate('mine-undo', 'nav')
  }
  return false
})

watch(
  () => route.fullPath,
  () => clearMineUndo(props.change),
)
watch(
  () => titleActions.target,
  (target) => {
    if (target)
      clearMineUndo(props.change)
  },
  { flush: 'sync' },
)
watch(
  mineEditor,
  (editor) => {
    if (editor)
      clearMineUndo(props.change)
  },
  { flush: 'sync' },
)
watch(
  () => titleActions.version,
  () => {
    if (!busy.value)
      clearMineUndo(props.change)
  },
  { flush: 'sync' },
)

async function undo() {
  if (busy.value)
    return
  busy.value = true
  error.value = false
  clearTimeout(timer)
  try {
    await applyMineUndo(props.change, controller.signal)
    await returnFocus()
  }
  catch {
    if (isMineViewer(props.change.context))
      error.value = true
  }
  finally {
    busy.value = false
    schedule()
  }
}

onMounted(() => {
  void nextTick(() => {
    const current = focus.current()
    if (
      (!anchor || !anchor.isConnected)
      && current
      && !root.value?.contains(current)
    ) {
      anchor = current
    }
    schedule()
  })
})
onBeforeUnmount(() => {
  live = false
  clearTimeout(timer)
  controller.abort()
  stopFocus()
  stopKey()
})
</script>

<template>
  <div ref="root" class="mine-undo" :class="{ 'mine-undo--demo': demo }">
    <FocusSection name="mine-undo" class="mine-undo__content" manual-scroll>
      <span role="status">
        {{
          error
            ? t("actions.errors.save")
            : t(`mine.personal.feedback.${change.kind}`)
        }}
        · {{ change.title }}
        <template v-if="change.kind === 'logged'">
          ·
          {{
            change.day
              ? formatMineDate(change.day, locale, {
                day: "numeric",
                month: "short",
              })
              : t("mine.preview.diary.undated")
          }}</template>
      </span>
      <button v-focusable type="button" :aria-disabled="busy" @click="undo">
        {{ t("mine.preview.recommendations.undo") }}
      </button>
    </FocusSection>
  </div>
</template>

<style scoped>
.mine-undo {
  position: fixed;
  z-index: 35;
  bottom: var(--safe-y);
  left: 50%;
  max-width: calc(var(--u) * 1200);
  transform: translateX(-50%);
}
.mine-undo__content {
  display: flex;
  align-items: center;
  gap: calc(var(--u) * 24);
  padding: calc(var(--u) * 16) calc(var(--u) * 24);
  border-radius: var(--radius-m);
  background: var(--color-surface-raised);
  color: var(--color-text);
  font-size: var(--font-size-s);
}
.mine-undo--demo {
  bottom: calc(var(--safe-y) + 48px);
}
.mine-undo__content > span {
  min-width: 0;
  word-wrap: break-word;
}
.mine-undo button {
  flex-shrink: 0;
  padding: calc(var(--u) * 12) calc(var(--u) * 20);
  border: 0;
  border-radius: var(--radius-s);
  background: var(--color-glass);
  color: var(--color-accent);
  font: inherit;
}
.mine-undo button:focus {
  outline: calc(var(--u) * 4) solid var(--color-text);
}
</style>
