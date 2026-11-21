<script setup lang="ts">
import type {
  MineTitlePersonal,
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
import { openMineEditor } from '../lib/mineEditor.ts'
import type { MineUndoInput } from '../lib/mineUndo.ts'
import { showMineUndo } from '../lib/mineUndo.ts'
import { isMineViewer, mineViewer } from '../lib/minePersonal.ts'
import { useFocus } from '../focus/index.ts'
import { captureTitleActionReturn } from '../focus/titleActionReturn.ts'
import {
  captureTitleViewer,
  closeTitleActions,
  isTitleActionCurrent,
  isTitleViewer,
  knownTitleMine,
  noteTitleDownload,
  noteTitleProgress,
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
const personal = shallowRef<MineTitlePersonal>()
const personalError = ref(false)
let personalRequest = 0
const texts = useDownloadTexts()
const busy = ref(false)
const toast = ref('')
let returnFocus = () => false
let opener: HTMLElement | undefined
let loadToken = 0
const rereadMine = ref(false)

async function load(item: ActionTarget) {
  const token = ++loadToken
  const viewer = captureTitleViewer()
  const revision = titleMineRevision(item.id)

  download.value = undefined
  personal.value = undefined
  void loadPersonal(item.id, token)
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

async function loadPersonal(id: string, token: number) {
  const context = mineViewer()
  if (!context)
    return
  const request = ++personalRequest
  personalError.value = false
  try {
    const data = await api.mine.getMineTitlePersonal(id, {
      expectedProfileId: context.expectedProfileId,
      language: language.value,
    })
    if (
      isMineViewer(context)
      && token === loadToken
      && request === personalRequest
    ) {
      personal.value = data
    }
  }
  catch {
    if (
      isMineViewer(context)
      && token === loadToken
      && request === personalRequest
    ) {
      personalError.value = true
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
      personal.value = undefined
      rereadMine.value = false
      return
    }

    rereadMine.value = false
    opener = focus.current()
    returnFocus = captureTitleActionReturn(focus, opener)
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
  if (!personal.value)
    return
  const watched = !personal.value.seen.title
  const currentLanguage = language.value
  const token = loadToken

  return run((id, viewer) =>
    mutateTitleMine(
      id,
      viewer,
      () =>
        saveTitleWatched(id, watched, currentLanguage, viewer, (updated) => {
          if (
            isTitleViewer(viewer)
            && token === loadToken
            && target.value?.id === id
          ) {
            personalRequest++
            personal.value = updated
          }
        }),
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

const cycleOptions = computed<PanelOption[]>(() => {
  const item = target.value
  if (!item)
    return []
  const choices: PanelOption[] = []
  const state = personal.value?.continuation ?? item.continuation?.state
  const cycle = personal.value?.cycle ?? item.continuation
  const cycleState
    = cycle
      && ('state' in cycle && 'id' in cycle
        ? cycle.state
        : item.continuation?.cycleState)
  const add = (id: string, label: string) =>
    choices.push({
      id,
      label: t(`mine.personal.${label}`),
      selected: false,
      disabled: busy.value,
    })
  if (item.continuation) {
    if (state === 'normal') {
      add('pauseContinue', 'pauseContinue')
      add('hideContinue', 'hideContinue')
    }
    else {
      add('restoreContinue', 'restoreContinue')
    }
  }
  if (cycleState === 'active')
    add('pauseCycle', 'pauseRewatch')
  if (cycleState === 'paused')
    add('resumeCycle', 'resumeRewatch')
  if (cycleState === 'active' || cycleState === 'paused')
    add('endCycle', 'endRewatch')
  else if (item.kind === 'series' && personal.value)
    add('startCycle', 'startRewatch')
  return choices
})

async function changeContinuation(id: string) {
  const item = target.value
  const context = mineViewer()
  if (!item || !context || busy.value)
    return
  const token = loadToken
  const body = {
    expectedProfileId: context.expectedProfileId,
    language: language.value,
  }
  let undo: MineUndoInput | undefined
  const undoBase = {
    titleId: item.id,
    title: item.title,
    language: language.value,
    context,
    opener,
  }
  busy.value = true
  try {
    if (id.endsWith('Cycle')) {
      const cycleId = personal.value?.cycle?.id ?? item.continuation?.cycleId
      if (!cycleId)
        return
      const action
        = id === 'pauseCycle' ? 'pause' : id === 'resumeCycle' ? 'resume' : 'end'
      const cycle = await api.mine.patchMineCycle(cycleId, { ...body, action })
      if (action === 'pause') {
        undo = {
          ...undoBase,
          kind: 'cyclePaused',
          cycleId,
          updatedAt: cycle.updatedAt,
        }
      }
    }
    else {
      const continuation
        = id === 'pauseContinue'
          ? 'paused'
          : id === 'hideContinue'
            ? 'hidden'
            : 'normal'
      const before
        = personal.value?.continuation ?? item.continuation?.state ?? 'normal'
      await api.mine.patchMineTitlePersonal(item.id, { ...body, continuation })
      if (continuation !== 'normal') {
        undo = {
          ...undoBase,
          kind: continuation === 'hidden' ? 'hidden' : 'paused',
          before,
          after: continuation,
        }
      }
    }
    if (!isMineViewer(context))
      return
    noteTitleProgress(context.viewer, item.id, false)
    if (token === loadToken) {
      close()
      if (undo)
        showMineUndo(undo)
    }
  }
  catch {
    if (isMineViewer(context) && token === loadToken)
      toast.value = t('actions.errors.save')
  }
  finally {
    if (isMineViewer(context) && token === loadToken)
      busy.value = false
  }
}

function personalEditor(kind: 'log' | 'titleNote' | 'cycle') {
  const item = target.value
  if (!item)
    return
  closeTitleActions()
  openMineEditor({ kind, title: item }, opener)
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
        (personal.value?.seen.title ?? state?.status === 'watched')
          ? 'actions.unmarkWatched'
          : 'actions.markWatched',
      ),
      selected: false,
      disabled: !personal.value,
    },
    { id: 'logWatch', label: t('mine.personal.logWatch'), selected: false },
    ...(personalError.value
      ? [
          {
            id: 'retryPersonal',
            label: t('panel.common.retry'),
            selected: false,
          },
        ]
      : []),
    { id: 'titleNote', label: t('mine.personal.titleNote'), selected: false },
    ...cycleOptions.value,
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
    case 'retryPersonal':
      if (!busy.value && target.value)
        void loadPersonal(target.value.id, loadToken)
      break
    case 'logWatch':
      personalEditor('log')
      break
    case 'titleNote':
      personalEditor('titleNote')
      break
    case 'startCycle':
      personalEditor('cycle')
      break
    case 'pauseContinue':
    case 'restoreContinue':
    case 'hideContinue':
    case 'pauseCycle':
    case 'resumeCycle':
    case 'endCycle':
      void changeContinuation(id)
      break
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
