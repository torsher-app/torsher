<script setup lang="ts">
import type { SourceCandidate } from '@torsher/api-client'
import type { SourceChoice } from '../components/SourcesScreen.vue'
import { getErrorBody, getErrorStatus } from '@torsher/api-client'
import { onBeforeUnmount, onDeactivated, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  activationTrigger,
  diagnostic,
  diagnosticAction,
  diagnosticParams,
  diagnosticRoute,
} from '../diagnostics/index.ts'
import { api } from '../api.ts'
import AppToast from '../components/AppToast.vue'
import SourcesScreen from '../components/SourcesScreen.vue'
import {
  libraryRoute,
  resolveRoute,
  withStartPosition,
} from '../lib/continue.ts'
import { goBack } from '../lib/navigation.ts'

defineOptions({ name: 'SourcesPage' })

/**
 * «Источники» тайтла. Выбор раздачи подключает её и открывает «Файлы».
 */
const props = defineProps<{
  id: string
  // Открыли с «Скачать»: выбранная раздача откроет «Файлы» с отметками
  download?: boolean
  season?: string
  episode?: string
  start?: string
}>()

const { t } = useI18n()
const router = useRouter()

// Выбор раздачи: подключаем её и переходим к «Файлам»; ошибка — тостом
const opening = ref<string>()
const openError = ref('')
let openGeneration = 0

function cancelOpen() {
  openGeneration++
  opening.value = undefined
  openError.value = ''
}

onDeactivated(cancelOpen)
onBeforeUnmount(cancelOpen)

async function openErrorKey(err: unknown) {
  switch (getErrorStatus(err)) {
    case 422: {
      const body = await getErrorBody<{ kind?: string }>(err)

      return body?.kind === 'candidate_gone' ? 'gone' : 'notPlayable'
    }
    case 503:
      return 'engine'
    case 401:
      return 'unauthorized'
    default:
      return 'unknown'
  }
}

async function open(candidate: SourceCandidate, choice: SourceChoice) {
  if (opening.value)
    return

  const context = Object.freeze({
    ...diagnosticAction(),
    rankingDecisionId: choice.rankingDecisionId,
  })
  diagnostic(
    {
      event: 'selection.activated',
      slot: 'source',
      trigger: activationTrigger(),
      titleId: props.id,
      candidateId: candidate.id,
    },
    context,
    true,
  )
  if (
    props.season !== undefined
    && props.episode !== undefined
    && !props.download
  ) {
    const route = resolveRoute(
      props.id,
      Number(props.season),
      Number(props.episode),
    )
    void router.push(
      diagnosticRoute(
        withStartPosition(
          {
            ...route,
            query: { ...route.query, candidate: candidate.id, q: choice.query },
          },
          props.start === '0',
        ),
        context,
      ),
    )
    return
  }

  opening.value = candidate.id
  openError.value = ''
  const generation = ++openGeneration

  try {
    const result = await api.titles.postTitleOpen(
      props.id,
      {
        candidateId: candidate.id,
        query: choice.query,
      },
      diagnosticParams(context),
    )
    if (generation !== openGeneration)
      return

    // Выбран сезон — «Файлы» встают на его первую серию; при «Скачать» —
    // отмечают его серии
    const season
      = props.download && props.season
        ? props.season
        : choice.season === undefined
          ? undefined
          : String(choice.season)

    router.push({
      path: `/title/${props.id}/files/${result.torrentId}`,
      state: { diagnostic: { ...context } },
      query: { season, download: props.download ? '1' : undefined },
    })
  }
  catch (err) {
    if (generation !== openGeneration)
      return
    const key = await openErrorKey(err)
    if (generation === openGeneration)
      openError.value = t(`watch.errors.${key}`)
  }
  finally {
    if (generation === openGeneration)
      opening.value = undefined
  }
}

function playLibrary(
  fileId: string,
  title: { season?: number | null, episode?: number | null },
) {
  cancelOpen()
  const context = diagnosticAction()
  diagnostic(
    {
      event: 'selection.activated',
      slot: 'libraryVersion',
      trigger: activationTrigger(),
      titleId: props.id,
      mediaFileId: fileId,
    },
    context,
    true,
  )
  router.push(
    diagnosticRoute(
      withStartPosition(
        libraryRoute(fileId, { id: props.id, ...title }),
        props.start === '0'
        && String(title.season) === props.season
        && String(title.episode) === props.episode,
      ),
      context,
    ),
  )
}

function back() {
  cancelOpen()
  goBack(router)
}
</script>

<template>
  <main>
    <SourcesScreen
      :id="id"
      :download="download"
      :season="season"
      :episode="episode"
      :opening="opening"
      @select="open"
      @library="playLibrary"
      @back="back"
    />
    <AppToast :message="openError" @hide="openError = ''" />
  </main>
</template>
