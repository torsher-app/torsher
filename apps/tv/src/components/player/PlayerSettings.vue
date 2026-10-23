<script setup lang="ts">
import type { PlayerSettings } from '@torsher/api-client'
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFocus } from '../../focus/index.ts'
import { copyText } from '../../lib/clipboard.ts'
import { PLAYBACK_SPEEDS } from '../../lib/player.ts'
import FocusSection from '../FocusSection.vue'
import PanelRow from './PanelRow.vue'
import PlayerPanel from './PlayerPanel.vue'

type View
  = | 'list'
    | 'speed'
    | 'subtitleSize'
    | 'subtitleBackground'
    | 'autoNext'
    | 'link'

interface Option {
  id: string
  label: string
  selected: boolean
}

const props = defineProps<{
  speed: number
  settings: PlayerSettings
  /** Адрес файла для VLC и Infuse */
  link: string
}>()

const emit = defineEmits<{
  speed: [value: number]
  update: [patch: Partial<PlayerSettings>]
}>()

const { t, locale } = useI18n()
const focus = useFocus()
const view = ref<View>('list')
const copied = ref(false)

function speedLabel(value: number) {
  return value === 1
    ? t('player.settings.speedNormal')
    : `${value.toLocaleString(locale.value.replace('_', '-'))}×`
}

const rows = computed(() => [
  {
    id: 'speed' as const,
    label: t('player.settings.speed'),
    detail: speedLabel(props.speed),
  },
  {
    id: 'subtitleSize' as const,
    label: t('player.settings.subtitleSize'),
    detail: t(`player.settings.sizes.${props.settings.subtitleSize}`),
  },
  {
    id: 'subtitleBackground' as const,
    label: t('player.settings.subtitleBackground'),
    detail: t(
      `player.settings.backgrounds.${props.settings.subtitleBackground}`,
    ),
  },
  {
    id: 'autoNext' as const,
    label: t('player.settings.autoNext'),
    detail: t(
      props.settings.autoNext ? 'player.settings.on' : 'player.settings.off',
    ),
  },
  {
    id: 'link' as const,
    label: t('player.settings.link'),
    detail: t('player.settings.linkHint'),
  },
])

const options = computed<Option[]>(() => {
  const { settings } = props

  switch (view.value) {
    case 'speed':
      return PLAYBACK_SPEEDS.map(value => ({
        id: String(value),
        label: speedLabel(value),
        selected: value === props.speed,
      }))
    case 'subtitleSize':
      return (['s', 'm', 'l'] as const).map(size => ({
        id: size,
        label: t(`player.settings.sizes.${size}`),
        selected: size === settings.subtitleSize,
      }))
    case 'subtitleBackground':
      return (['none', 'shadow', 'box'] as const).map(background => ({
        id: background,
        label: t(`player.settings.backgrounds.${background}`),
        selected: background === settings.subtitleBackground,
      }))
    case 'autoNext':
      return [true, false].map(on => ({
        id: String(on),
        label: t(on ? 'player.settings.on' : 'player.settings.off'),
        selected: on === settings.autoNext,
      }))
    default:
      return []
  }
})

const title = computed(() =>
  view.value === 'list'
    ? t('player.settings.button')
    : t(`player.settings.${view.value}`),
)

async function open(next: View) {
  copied.value = false
  view.value = next
  await nextTick()
  focus.activate('player-settings')
}

function choose(id: string) {
  if (view.value === 'speed') {
    emit('speed', Number(id))
  }
  else if (view.value === 'subtitleSize') {
    emit('update', { subtitleSize: id as PlayerSettings['subtitleSize'] })
  }
  else if (view.value === 'subtitleBackground') {
    emit('update', {
      subtitleBackground: id as PlayerSettings['subtitleBackground'],
    })
  }
  else if (view.value === 'autoNext') {
    emit('update', { autoNext: id === 'true' })
  }

  void back()
}

async function copy() {
  copied.value = await copyText(props.link)
}

/** Back внутри панели: из выбора — к списку. `false` — панель закрывается */
function back() {
  if (view.value === 'list')
    return false

  const from = view.value

  view.value = 'list'
  void nextTick(() => {
    const row = document.querySelector<HTMLElement>(`[data-setting="${from}"]`)

    if (row)
      focus.focusOn(row)
  })

  return true
}

defineExpose({ back })
</script>

<template>
  <PlayerPanel :title="title">
    <FocusSection :key="view" name="player-settings" autofocus manual-scroll>
      <template v-if="view === 'list'">
        <PanelRow
          v-for="row in rows"
          :key="row.id"
          :data-setting="row.id"
          :label="row.label"
          :detail="row.detail"
          @select="open(row.id)"
        />
      </template>

      <template v-else-if="view === 'link'">
        <p class="settings__note">
          {{ t("player.settings.linkHint") }}
        </p>
        <button v-focusable class="settings__link" type="button" @click="copy">
          {{ link }}
        </button>
        <p class="settings__note settings__note--copied">
          {{ copied ? t("player.settings.copied") : "" }}
        </p>
      </template>

      <template v-else>
        <PanelRow
          v-for="option in options"
          :key="option.id"
          :label="option.label"
          check
          :selected="option.selected"
          @select="choose(option.id)"
        />
      </template>
    </FocusSection>
  </PlayerPanel>
</template>

<style scoped>
.settings__note {
  min-height: calc(var(--font-size-s) * var(--line-height));
  margin: 0 0 calc(var(--u) * 18);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.settings__note--copied {
  margin-top: calc(var(--u) * 18);
  color: var(--color-ok);
}

/* Адрес целиком, переносом по любому символу: его читают с экрана */
.settings__link {
  display: block;
  width: 100%;
  padding: calc(var(--u) * 20) calc(var(--u) * 24);
  border: 0;
  border-radius: calc(var(--u) * 16);
  background: var(--color-glass);
  color: var(--color-text);
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: calc(var(--u) * 24);
  line-height: 1.4;
  text-align: left;
  word-break: break-all;
}

.settings__link:focus {
  box-shadow: 0 0 0 calc(var(--u) * 4) var(--color-focus);
}
</style>
