<script setup lang="ts">
import type { Playback } from '@torsher/api-client'
import { computed, nextTick, onMounted, onScopeDispose, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.ts'
import { useFocus } from '../../focus/index.ts'
import FocusSection from '../FocusSection.vue'
import PanelRow from './PanelRow.vue'
import PlayerPanel from './PlayerPanel.vue'

type Search = NonNullable<Playback['subtitleSearch']>
type Language = Search['languages'][number]
type Results = Awaited<
  ReturnType<typeof api.playback.postPlaybackSubtitleSearch>
>

const props = defineProps<{
  sessionId: string
  search: Search
  applying: boolean
}>()
const emit = defineEmits<{ apply: [id: string], close: [] }>()
const { t, locale } = useI18n()
const focus = useFocus()
const interfaceLanguage = locale.value.split(/[-_]/)[0]
const language = ref(
  props.search.languages.find(code => code === interfaceLanguage)
  ?? props.search.defaultLanguage,
)
const choosingLanguage = ref(false)
const loading = ref(false)
const result = ref<Results>()
const failed = ref(false)
let pending: AbortController | undefined

function languageLabel(code: string) {
  return t(`subtitleLanguages.${code}`)
}

function providerName(provider: string) {
  return provider === 'opensubtitles' ? 'OpenSubtitles.com' : 'SubDL'
}

function resultDetail(item: Results['items'][number]) {
  const match = item.match === 'title' ? 'titleMatch' : item.match
  return [
    providerName(item.provider),
    languageLabel(item.language),
    t(`player.subtitleSearch.${match}`),
    item.forced && t('player.forced'),
    item.hearingImpaired && t('player.subtitleSearch.sdh'),
  ]
    .filter(Boolean)
    .join(' · ')
}

const message = computed(() => {
  if (loading.value)
    return 'searching'
  if (failed.value)
    return 'unavailable'
  const found = result.value
  if (!found)
    return undefined
  if (found.issues.length) {
    if (found.issues.length < props.search.providers.length)
      return 'partial'
    return 'unavailable'
  }
  return found.items.length ? undefined : 'empty'
})

async function loadResults() {
  pending?.abort()
  const request = new AbortController()
  pending = request
  result.value = undefined
  failed.value = false
  loading.value = true
  try {
    const response = await api.playback.postPlaybackSubtitleSearch(
      props.sessionId,
      { language: language.value },
      { signal: request.signal },
    )
    if (pending === request)
      result.value = response
  }
  catch {
    if (pending === request)
      failed.value = true
  }
  finally {
    if (pending === request)
      loading.value = false
  }
}

async function showLanguages() {
  if (props.applying)
    return
  choosingLanguage.value = true
  await nextTick()
  focus.activate('player-subtitle-search')
}

async function backToResults() {
  choosingLanguage.value = false
  await nextTick()
  focus.activate('player-subtitle-search')
}

function choose(code: Language) {
  if (code !== language.value) {
    language.value = code
    void loadResults()
  }
  void backToResults()
}

function back() {
  if (!choosingLanguage.value)
    return false
  void backToResults()
  return true
}

defineExpose({ back })
onMounted(loadResults)
onScopeDispose(() => {
  const request = pending
  pending = undefined
  request?.abort()
})
</script>

<template>
  <PlayerPanel
    :title="
      t(
        choosingLanguage
          ? 'player.subtitleSearch.language'
          : 'player.subtitleSearch.title',
      )
    "
    :caption="search.providers.map(providerName).join(' · ')"
    @close="emit('close')"
  >
    <FocusSection
      :key="String(choosingLanguage)"
      name="player-subtitle-search"
      autofocus
      manual-scroll
    >
      <template v-if="choosingLanguage">
        <PanelRow
          v-for="code in search.languages"
          :key="code"
          :label="languageLabel(code)"
          :selected="code === language"
          check
          @select="choose(code)"
        />
      </template>
      <template v-else>
        <PanelRow
          :label="t('player.subtitleSearch.language')"
          :detail="languageLabel(language)"
          :aria-disabled="applying || undefined"
          @select="showLanguages"
        />
        <p v-if="message" class="subtitle-search__state" role="status">
          {{ t(`player.subtitleSearch.${message}`) }}
        </p>
        <PanelRow
          v-if="!loading && (failed || result?.issues.length)"
          :label="t('player.retry')"
          :aria-disabled="applying || undefined"
          @select="!applying && loadResults()"
        />
        <PanelRow
          v-for="item in result?.items ?? []"
          :key="item.id"
          :label="item.release || providerName(item.provider)"
          :detail="resultDetail(item)"
          :aria-disabled="applying || undefined"
          @select="emit('apply', item.id)"
        />
      </template>
    </FocusSection>
  </PlayerPanel>
</template>

<style scoped>
.subtitle-search__state {
  margin: calc(var(--u) * 12) calc(var(--u) * 24);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}
</style>
