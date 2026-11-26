import type {
  TitleCleanupPreview,
  TitleCleanupResult,
  TitleCleanupTitles,
} from '@torsher/api-client'
import { computed, ref, shallowRef } from 'vue'
import { api } from '~/services/api'

export const TITLE_CLEANUP_LIMIT = 50

export function useTitleCleanup() {
  const items = shallowRef<TitleCleanupTitles['items']>([])
  const selected = ref(new Set<string>())
  const state = ref<'loading' | 'ready' | 'error'>('loading')
  const previewOpen = ref(false)
  const preview = shallowRef<TitleCleanupPreview>()
  const result = shallowRef<TitleCleanupResult>()
  const previewError = ref(false)
  const actionError = ref(false)
  const previewing = ref(false)
  const executing = ref(false)
  const scope = ref<string[]>([])

  const confirmation = computed(() => {
    const planned = preview.value?.items
    if (!planned?.length || planned.length !== scope.value.length)
      return []
    const confirmed = planned.flatMap(item =>
      item.fingerprint && item.reason === null
        ? [{ id: item.id, fingerprint: item.fingerprint }]
        : [],
    )
    const ids = new Set(confirmed.map(item => item.id))
    return scope.value.every(id => ids.has(id)) ? confirmed : []
  })

  async function load() {
    if (state.value !== 'ready')
      state.value = 'loading'
    try {
      const data = await withErrorMode('silent', () =>
        api.torrents.getTitleCleanupTitles())
      items.value = data.items
      const available = new Set(data.items.map(item => item.id))
      selected.value = new Set(
        [...selected.value].filter(id => available.has(id)),
      )
      state.value = 'ready'
    }
    catch {
      state.value = 'error'
    }
  }

  function toggle(id: string, checked: boolean) {
    if (!checked) {
      selected.value.delete(id)
      return
    }
    if (selected.value.size < TITLE_CLEANUP_LIMIT)
      selected.value.add(id)
  }

  async function openPreview() {
    if (!selected.value.size || previewing.value || executing.value)
      return
    scope.value = [...selected.value]
    previewOpen.value = true
    await refreshPreview()
  }

  async function refreshPreview() {
    if (!scope.value.length || previewing.value || executing.value)
      return
    previewing.value = true
    previewError.value = false
    actionError.value = false
    preview.value = undefined
    result.value = undefined
    try {
      preview.value = await withErrorMode('silent', () =>
        api.torrents.postTitleCleanupPreview({ titleIds: scope.value }))
    }
    catch {
      previewError.value = true
    }
    finally {
      previewing.value = false
    }
  }

  async function excludeFromPreview(id: string) {
    if (previewing.value || executing.value || result.value)
      return
    selected.value.delete(id)
    scope.value = scope.value.filter(titleId => titleId !== id)
    if (scope.value.length)
      await refreshPreview()
    else previewOpen.value = false
  }

  async function execute() {
    const confirmed = confirmation.value
    if (
      !confirmed.length
      || executing.value
      || result.value
      || actionError.value
    ) {
      return
    }
    executing.value = true
    const finished: TitleCleanupResult['items'] = []
    try {
      // Каждый тайтл получает собственный бюджет HTTP-запроса.
      for (const item of confirmed) {
        try {
          const response = await withErrorMode('silent', () =>
            api.torrents.postTitleCleanupExecute({ items: [item] }))
          const outcome = response.items.find(
            outcome => outcome.id === item.id,
          )
          if (!outcome) {
            actionError.value = true
            continue
          }
          finished.push(outcome)
          if (outcome.status === 'deleted')
            selected.value.delete(item.id)
        }
        catch {
          actionError.value = true
          const operationIds = await pendingOperations(item.id)
          if (operationIds.length)
            finished.push({ id: item.id, status: 'partial', operationIds })
        }
      }
      result.value = { items: finished }
    }
    finally {
      await load()
      executing.value = false
    }
  }

  async function pendingOperations(titleId: string) {
    try {
      const status = await withErrorMode('silent', () =>
        api.libraryMaintenance.getLibraryMaintenanceStatus())
      return status.operations
        .filter(
          op =>
            op.titleId === titleId
            && /^manual-(?:torrent|library):/.test(op.groupId)
            && op.action === 'retry',
        )
        .map(op => op.id)
    }
    catch {
      return []
    }
  }

  async function retryOperations(ids: string[]) {
    if (executing.value)
      return
    executing.value = true
    actionError.value = false
    try {
      for (const id of ids) {
        const status = await withErrorMode('silent', () =>
          api.libraryMaintenance.retryLibraryMaintenanceOperation(id))
        if (
          status.operations.some(
            item => item.id === id && item.action === 'retry',
          )
        ) {
          actionError.value = true
        }
      }
    }
    catch {
      actionError.value = true
    }
    finally {
      await load()
      executing.value = false
    }
    if (!actionError.value)
      previewOpen.value = false
  }

  return {
    items,
    selected,
    state,
    previewOpen,
    preview,
    result,
    previewError,
    actionError,
    previewing,
    executing,
    confirmation,
    load,
    toggle,
    openPreview,
    refreshPreview,
    excludeFromPreview,
    execute,
    retryOperations,
  }
}
