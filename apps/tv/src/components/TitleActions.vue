<script setup lang="ts">
import type {
  TitleDownload,
  TitleMine,
  UpdateTitleMineInput,
} from '@torsher/api-client'
import type { ActionStep, ActionTarget } from '../titleActions.ts'
import type { PanelOption } from './OptionsPanel.vue'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { api } from '../api.ts'
import { useCatalogLanguage } from '../composables/useCatalogLanguage.ts'
import { useDownloadTexts } from '../composables/useTitleDownload.ts'
import { useFocus } from '../focus/index.ts'
import {
  closeTitleActions,
  knownTitleMine,
  noteTitleDownload,
  noteTitleMine,
  rememberTitleMine,
  titleActions,
} from '../titleActions.ts'
import AppToast from './AppToast.vue'
import OptionsPanel from './OptionsPanel.vue'
import RatingPicker from './RatingPicker.vue'

const { t } = useI18n()
const router = useRouter()
const focus = useFocus()
const language = useCatalogLanguage()

const target = computed(() => titleActions.target)
const step = ref<ActionStep>('main')
const mine = shallowRef<TitleMine>()
// «Оставить»: есть ли что сохранить и не оставлено ли уже
const download = shallowRef<TitleDownload>()
const texts = useDownloadTexts()
const busy = ref(false)
const toast = ref('')
let opener: HTMLElement | undefined
let loadToken = 0

async function load(item: ActionTarget) {
  const token = ++loadToken
  const known = knownTitleMine(item.id)

  mine.value = known
  download.value = undefined
  void loadDownload(item.id, token)

  try {
    const fresh = await api.titles.getTitleMine(item.id, {
      language: language.value,
    })

    if (token !== loadToken)
      return

    mine.value = fresh
    rememberTitleMine(item.id, fresh)
  }
  catch {
    if (token === loadToken && !known)
      toast.value = t('actions.errors.load')
  }
}

async function loadDownload(id: string, token: number) {
  try {
    const fresh = await api.titles.getTitleDownload(id)

    if (token === loadToken)
      download.value = fresh
  }
  catch {
    // Без состояния пункта «Оставить» нет: остальное меню работает
  }
}

async function keep() {
  const item = target.value

  if (!item || busy.value)
    return

  busy.value = true

  try {
    const fresh = await api.titles.postTitleKeep(item.id)

    download.value = fresh
    noteTitleDownload(item.id, fresh)
    toast.value = t('download.keptToast')
  }
  catch (err) {
    toast.value = await texts.errorOf(err)
  }
  finally {
    busy.value = false
  }
}

watch(target, (item) => {
  if (!item)
    return

  opener = focus.current() ?? undefined
  step.value = titleActions.step
  void load(item)
})

function close() {
  closeTitleActions()
  mine.value = undefined

  nextTick(() => {
    if (opener?.isConnected)
      focus.focusOn(opener)
  })
}

// Шаг, открытый прямо с карточки, закрывается целиком: меню там не открывали
function back() {
  if (step.value === 'main' || titleActions.step !== 'main')
    close()
  else step.value = 'main'
}

// Значки постеров и карточка видят правку сразу, ещё до ответа сервера
function show(id: string, next: TitleMine) {
  if (target.value?.id === id)
    mine.value = next

  noteTitleMine(id, next)
}

async function run(
  change: (id: string) => Promise<TitleMine>,
  optimistic?: TitleMine,
) {
  const item = target.value

  if (!item || busy.value)
    return

  const before = mine.value

  busy.value = true

  if (optimistic)
    show(item.id, optimistic)

  try {
    show(item.id, await change(item.id))
  }
  catch {
    if (before)
      show(item.id, before)

    toast.value = t('actions.errors.save')
  }
  finally {
    busy.value = false
  }
}

function patch(body: UpdateTitleMineInput) {
  const current = mine.value

  return run(
    id => api.titles.patchTitleMine(id, body, { language: language.value }),
    current && {
      ...current,
      ...(body.watchlist !== undefined && { watchlist: body.watchlist }),
      ...(body.favorite !== undefined && { favorite: body.favorite }),
      ...(body.rating !== undefined && { rating: body.rating }),
    },
  )
}

function toggleWatched() {
  const watched = mine.value?.status !== 'watched'

  return run(async (id) => {
    await api.titles.putTitleWatched(
      id,
      { watched },
      { language: language.value },
    )

    return api.titles.getTitleMine(id, { language: language.value })
  })
}

async function toggleCollection(id: string) {
  const current = mine.value
  const entry = current?.collections.find(item => item.id === id)

  if (!current || !entry)
    return

  const collections = current.collections.map(item =>
    item.id === id ? { ...item, contains: !item.contains } : item,
  )

  await run(
    async (titleId) => {
      if (entry.contains)
        await api.collections.deleteCollectionTitle(id, titleId)
      else await api.collections.putCollectionTitle(id, titleId)

      return { ...current, collections }
    },
    { ...current, collections },
  )
}

// Запрос уходит до закрытия: панель закрывается сразу, оценка видна на постере
function rate(value: number | null) {
  const saving = patch({ rating: value })

  close()

  return saving
}

const statusLine = computed(() => {
  const status = mine.value?.status

  return status ? t(`status.${status}`) : undefined
})

const keepOptions = computed<PanelOption[]>(() => {
  const value = download.value

  if (value?.canKeep) {
    return [
      {
        id: 'keep',
        label: t('download.keep'),
        hint: t('download.keepHint'),
        selected: false,
      },
    ]
  }

  if (value?.state) {
    return [
      {
        id: 'kept',
        label: t('download.kept'),
        hint: t(
          value.state === 'library'
            ? 'download.state.library'
            : 'download.keptHint',
        ),
        selected: true,
      },
    ]
  }

  return []
})

// С карточки, где всё уже в библиотеке: выбор другой раздачи для загрузки
const redownloadOptions = computed<PanelOption[]>(() => {
  const redownload = target.value?.redownload

  if (!redownload)
    return []

  return [
    {
      id: 'redownload',
      label:
        redownload.season === undefined
          ? t('download.other')
          : t('download.otherSeason', { n: redownload.season }),
      selected: false,
      detail: '›',
    },
  ]
})

function openRedownload() {
  const item = target.value

  if (!item?.redownload)
    return

  const { season } = item.redownload

  closeTitleActions()
  router.push({
    path: `/title/${item.id}/sources`,
    query: {
      download: '1',
      season: season === undefined ? undefined : String(season),
    },
  })
}

const mainOptions = computed<PanelOption[]>(() => {
  const state = mine.value
  const rating = state?.rating

  return [
    {
      id: 'watchlist',
      label: t('actions.watchlist'),
      selected: !!state?.watchlist,
    },
    {
      id: 'favorite',
      label: t('actions.favorite'),
      selected: !!state?.favorite,
    },
    {
      id: 'rate',
      label: t('actions.rate'),
      selected: false,
      detail: rating ? t('rating.own', { n: rating }) : '›',
    },
    {
      id: 'collections',
      label: t('actions.collections'),
      selected: false,
      detail: '›',
    },
    {
      id: 'dropped',
      label: t('actions.dropped'),
      selected: state?.status === 'dropped',
    },
    {
      id: 'watched',
      label: t(
        state?.status === 'watched'
          ? 'actions.unmarkWatched'
          : 'actions.markWatched',
      ),
      selected: false,
    },
    // Последним: пункт появляется, когда пришло состояние, и не сдвигает верх
    ...keepOptions.value,
    ...redownloadOptions.value,
  ]
})

const collectionOptions = computed<PanelOption[]>(() =>
  (mine.value?.collections ?? []).map(item => ({
    id: item.id,
    label: item.name,
    selected: item.contains,
  })),
)

function select(id: string) {
  const state = mine.value

  if (step.value === 'collections') {
    void toggleCollection(id)

    return
  }

  switch (id) {
    case 'watchlist':
      void patch({ watchlist: !state?.watchlist })
      break
    case 'favorite':
      void patch({ favorite: !state?.favorite })
      break
    case 'dropped':
      void patch({ dropped: state?.status !== 'dropped' })
      break
    case 'watched':
      void toggleWatched()
      break
    case 'rate':
      step.value = 'rating'
      break
    case 'collections':
      step.value = 'collections'
      break
    case 'keep':
      void keep()
      break
    case 'redownload':
      openRedownload()
      break
  }
}

onBeforeUnmount(() => {
  loadToken++
})
</script>

<template>
  <OptionsPanel
    v-if="target"
    :key="step"
    :title="step === 'main' ? target.title : t(`actions.steps.${step}`)"
    :subtitle="step === 'main' ? statusLine : target.title"
    :options="step === 'collections' ? collectionOptions : mainOptions"
    :focus-selected="false"
    @select="select"
    @close="back"
  >
    <RatingPicker
      v-if="step === 'rating'"
      :value="mine?.rating ?? null"
      @select="rate"
    />
    <p
      v-else-if="step === 'collections' && mine && !mine.collections.length"
      class="title-actions__empty"
    >
      {{ t("actions.noCollections") }}
    </p>
  </OptionsPanel>
  <AppToast :message="toast" @hide="toast = ''" />
</template>

<style scoped>
.title-actions__empty {
  margin: 0;
  color: var(--color-text-muted);
}
</style>
