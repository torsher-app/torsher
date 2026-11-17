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
import {
  mutateTitleMine,
  patchTitleMine,
} from '../composables/useTitleMineMutation.ts'
import { saveTitleWatched } from '../composables/useTitleWatched.ts'
import { useCatalogLanguage } from '../composables/useCatalogLanguage.ts'
import { useDownloadTexts } from '../composables/useTitleDownload.ts'
import { useFocus } from '../focus/index.ts'
import { captureTitleActionReturn } from '../focus/titleActionReturn.ts'
import {
  captureTitleViewer,
  closeTitleActions,
  isTitleActionCurrent,
  isTitleViewer,
  knownTitleMine,
  noteTitleDownload,
  rememberTitleMine,
  titleActions,
  titleMineProgressVersion,
  titleMineRevision,
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
const mine = computed(() =>
  target.value ? knownTitleMine(target.value.id) : undefined,
)
// «Оставить»: есть ли что сохранить и не оставлено ли уже
const download = shallowRef<TitleDownload>()
const texts = useDownloadTexts()
const busy = ref(false)
const toast = ref('')
let returnFocus = () => false
let loadToken = 0
const rereadMine = ref(false)

async function load(item: ActionTarget) {
  const token = ++loadToken
  const viewer = captureTitleViewer()
  const revision = titleMineRevision(item.id)

  download.value = undefined
  void loadDownload(item.id, token, viewer)

  try {
    const fresh = await api.titles.getTitleMine(item.id, {
      language: language.value,
    })

    if (
      token !== loadToken
      || !isTitleViewer(viewer)
      || revision !== titleMineRevision(item.id)
    ) {
      return
    }

    rememberTitleMine(item.id, fresh, viewer, revision)
  }
  catch {
    if (
      token === loadToken
      && isTitleViewer(viewer)
      && !knownTitleMine(item.id)
    ) {
      toast.value = t('actions.errors.load')
    }
  }
}

async function loadDownload(id: string, token: number, viewer: number) {
  try {
    const fresh = await api.titles.getTitleDownload(id)

    if (token === loadToken && isTitleViewer(viewer))
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
  const viewer = captureTitleViewer()
  const token = loadToken

  try {
    const fresh = await api.titles.postTitleKeep(item.id)

    if (!isTitleViewer(viewer))
      return
    if (token === loadToken)
      download.value = fresh
    noteTitleDownload(item.id, fresh, viewer)
    if (token === loadToken)
      toast.value = t('download.keptToast')
  }
  catch (err) {
    const message = await texts.errorOf(err)
    if (isTitleViewer(viewer) && token === loadToken)
      toast.value = message
  }
  finally {
    if (isTitleViewer(viewer) && token === loadToken)
      busy.value = false
  }
}

watch(
  target,
  (item) => {
    if (!item) {
      loadToken++
      busy.value = false
      download.value = undefined
      rereadMine.value = false
      return
    }

    rereadMine.value = false
    returnFocus = captureTitleActionReturn(focus, focus.current())
    step.value = titleActions.step
    void load(item)
  },
  { flush: 'sync' },
)

function close() {
  const viewer = captureTitleViewer()
  const generation = titleActions.menuRevision
  const restore = returnFocus
  closeTitleActions()

  nextTick(() => {
    if (isTitleActionCurrent(viewer, generation) && !target.value)
      restore()
  })
}

// Шаг, открытый прямо с карточки, закрывается целиком: меню там не открывали
function back() {
  if (step.value === 'main' || titleActions.step !== 'main')
    close()
  else step.value = 'main'
}

async function run(saving: (id: string, viewer: number) => Promise<void>) {
  const item = target.value
  if (!item || busy.value)
    return
  const viewer = captureTitleViewer()
  const token = loadToken
  const generation = titleActions.menuRevision
  busy.value = true
  try {
    await saving(item.id, viewer)
  }
  catch {
    if (isTitleActionCurrent(viewer, generation))
      toast.value = t('actions.errors.save')
  }
  finally {
    if (isTitleViewer(viewer) && token === loadToken)
      busy.value = false
  }
}

watch(
  [
    () => target.value?.id,
    () => target.value && titleMineProgressVersion(target.value.id),
  ],
  ([id, version], [previousId, previousVersion]) => {
    if (id && id === previousId && version !== previousVersion)
      rereadMine.value = true
  },
)
watch(
  [
    rereadMine,
    busy,
    () => target.value && titleActions.writing.has(target.value.id),
  ],
  () => {
    const item = target.value
    if (
      rereadMine.value
      && item
      && !busy.value
      && !titleActions.writing.has(item.id)
    ) {
      rereadMine.value = false
      void load(item)
    }
  },
)

function patch(body: UpdateTitleMineInput) {
  const currentLanguage = language.value
  return run((id, viewer) => patchTitleMine(id, viewer, body, currentLanguage))
}

function toggleWatched() {
  const current = mine.value
  if (!current)
    return
  const watched = current.status !== 'watched'
  const currentLanguage = language.value

  return run((id, viewer) =>
    mutateTitleMine(
      id,
      viewer,
      () => saveTitleWatched(id, watched, currentLanguage, viewer),
      undefined,
      false,
    ),
  )
}

async function toggleCollection(id: string) {
  const current = mine.value
  const entry = current?.collections.find(item => item.id === id)

  if (!current || !entry)
    return

  const contains = !entry.contains
  const update = (value: TitleMine) => ({
    ...value,
    collections: value.collections.map(item =>
      item.id === id ? { ...item, contains } : item,
    ),
  })
  await run((titleId, viewer) =>
    mutateTitleMine(
      titleId,
      viewer,
      async (latest) => {
        if (entry.contains)
          await api.collections.deleteCollectionTitle(id, titleId)
        else await api.collections.putCollectionTitle(id, titleId)
        return latest ? update(latest) : undefined
      },
      update,
    ),
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

function openTitle() {
  const item = target.value

  if (!item?.canOpenTitle)
    return

  closeTitleActions()
  router.push(`/title/${item.id}`)
}

const mainOptions = computed<PanelOption[]>(() => {
  const state = mine.value
  const rating = state?.rating

  return [
    ...(target.value?.canOpenTitle
      ? [{ id: 'openTitle', label: t('actions.openTitle'), selected: false }]
      : []),
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
    case 'openTitle':
      openTitle()
      break
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
