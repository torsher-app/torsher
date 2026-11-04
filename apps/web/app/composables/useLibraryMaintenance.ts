import type {
  MaintenanceConfig,
  MaintenanceDefaultPreview,
  MaintenanceGroup,
  MaintenancePreview,
  MaintenanceRuleOptionsInput,
  MaintenanceStatus,
} from '@torsher/api-client'
import { getErrorMessage, getErrorStatus } from '@torsher/api-client'
import { api } from '~/services/api'

export function useLibraryMaintenance(titleId: () => string) {
  const config = shallowRef<MaintenanceConfig | null>(null)
  const preview = shallowRef<MaintenancePreview | null>(null)
  const commonPreview = shallowRef<MaintenanceDefaultPreview | null>(null)
  const status = shallowRef<MaintenanceStatus | null>(null)
  const busy = ref(false)
  const error = ref('')
  const detail = ref('')
  let generation = 0
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    const current = generation
    busy.value = true
    error.value = ''
    detail.value = ''
    try {
      const result = await withErrorMode('silent', action)
      return current === generation ? result : undefined
    }
    catch (cause) {
      const message = await getErrorMessage(cause)
      if (current === generation) {
        error.value = getErrorStatus(cause) === 409 ? 'conflict' : 'error'
        detail.value = message
      }
    }
    finally {
      if (current === generation)
        busy.value = false
    }
  }
  async function load() {
    const result = await run(() =>
      Promise.all([
        titleId() === 'default'
          ? api.libraryMaintenance.getDefaultMaintenanceRule()
          : api.libraryMaintenance.getLibraryMaintenanceConfig(titleId()),
        api.libraryMaintenance.getLibraryMaintenanceStatus(),
      ]),
    )
    if (result) {
      config.value = result[0]
      status.value = result[1]
    }
    return result?.[0]
  }
  async function evaluate(options: MaintenanceRuleOptionsInput) {
    if (titleId() === 'default') {
      const result = await run(() =>
        api.libraryMaintenance.previewDefaultMaintenanceRule(options),
      )
      if (result)
        commonPreview.value = result
      return result
    }
    const result = await run(() =>
      api.libraryMaintenance.previewLibraryMaintenance(titleId(), options),
    )
    if (result)
      preview.value = result
    return result
  }
  async function save(options: MaintenanceRuleOptionsInput) {
    if (!config.value)
      return
    const body = { ...options, expectedRevision: config.value.rule.revision }
    const result = await run(() =>
      titleId() === 'default'
        ? api.libraryMaintenance.saveDefaultMaintenanceRule(body)
        : api.libraryMaintenance.saveLibraryMaintenanceConfig(titleId(), body),
    )
    if (result)
      config.value = result
    return result
  }
  async function previewInherited() {
    const result = await run(() =>
      api.libraryMaintenance.previewInheritedMaintenanceRule(titleId()),
    )
    if (result)
      preview.value = result
    return result
  }
  async function inherit() {
    if (!config.value || !status.value)
      return
    const body = {
      expectedRevision: config.value.rule.revision,
      defaultRevision: status.value.defaultRule.revision,
    }
    return run(() =>
      api.libraryMaintenance.inheritMaintenanceRule(titleId(), body),
    )
  }
  async function protect(
    group: MaintenanceGroup,
    options: MaintenanceRuleOptionsInput,
  ) {
    const result = await run(() =>
      api.libraryMaintenance.protectLibraryMaintenanceGroup(group.id, {
        protected: !group.protected,
        expectedRevision: group.revision,
      }),
    )
    if (result)
      await evaluate(options)
  }
  async function unsuppress(
    episode: MaintenanceStatus['suppressions'][number],
  ) {
    const result = await run(() =>
      api.libraryMaintenance.unsuppressLibraryMaintenance(titleId(), {
        episodes: [{ season: episode.season, episode: episode.episode }],
      }),
    )
    if (result)
      await load()
  }
  watch(
    titleId,
    () => {
      generation++
      config.value = null
      preview.value = null
      commonPreview.value = null
      status.value = null
      error.value = ''
    },
    { flush: 'sync' },
  )
  onBeforeUnmount(() => {
    generation++
  })
  return {
    config,
    preview,
    commonPreview,
    inherit,
    previewInherited,
    status,
    busy,
    error,
    detail,
    load,
    evaluate,
    save,
    protect,
    unsuppress,
  }
}
