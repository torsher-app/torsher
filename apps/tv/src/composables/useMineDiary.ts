import type { MineDiaryPage } from '@torsher/api-client'
import type { Ref } from 'vue'
import type { DiaryQuery } from '../lib/minePersonal.ts'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { api, loadErrorOf } from '../api.ts'
import { createLatest } from '../lib/latest.ts'
import { isMineViewer, mineViewer } from '../lib/minePersonal.ts'
import { useCatalogLanguage } from './useCatalogLanguage.ts'

type Filters = Omit<DiaryQuery, 'expectedProfileId' | 'language'>
type PageRequest = Pick<DiaryQuery, 'direction' | 'cursor' | 'anchorMonth'>
const PAGE_SIZE = 40
const WINDOW_PAGES = 3

export function useMineDiary(filters: Ref<Filters>, active: Ref<boolean>) {
  const language = useCatalogLanguage()
  const data = shallowRef<MineDiaryPage>()
  const error = ref<ReturnType<typeof loadErrorOf>>()
  const loading = ref(false)
  const latest = createLatest()
  let pages: { request: PageRequest, page: MineDiaryPage }[] = []
  let loadedKey: string | undefined

  const key = () => JSON.stringify([language.value, filters.value])

  async function load(
    first: PageRequest,
    count: number,
    direction?: 'older' | 'newer',
  ) {
    const context = mineViewer()
    if (!context || !active.value)
      return false

    loading.value = true
    error.value = undefined
    const requestedKey = key()
    const query = {
      expectedProfileId: context.expectedProfileId,
      language: language.value,
      ...filters.value,
      limit: PAGE_SIZE,
    }
    const outcome = await latest.run(async (signal) => {
      const chunks = []
      let request = first
      for (let index = 0; index < count; index++) {
        const page = await api.mine.getMineDiary(
          { ...query, ...request },
          { signal },
        )
        chunks.push({ request, page })
        if (!page.olderCursor || signal.aborted || !isMineViewer(context))
          break
        request = { direction: 'older', cursor: page.olderCursor }
      }
      return chunks
    })
    if (
      !active.value
      || !isMineViewer(context)
      || outcome.status === 'cancelled'
      || requestedKey !== key()
    ) {
      return false
    }
    loading.value = false
    if (outcome.status === 'failed') {
      error.value = loadErrorOf(outcome.error)
      return false
    }
    if (
      outcome.value.some(
        ({ page }) => page.profileId !== context.expectedProfileId,
      )
    ) {
      return false
    }
    loadedKey = requestedKey
    const received = outcome.value
    const fresh = received[0]!.page
    if (direction && !fresh.entries.length) {
      const edge = direction === 'older' ? pages[pages.length - 1] : pages[0]
      if (edge) {
        edge.page
          = direction === 'older'
            ? { ...edge.page, olderCursor: null }
            : { ...edge.page, newerCursor: null }
      }
    }
    else if (direction === 'older') {
      pages = [...pages, ...received].slice(-WINDOW_PAGES)
    }
    else if (direction === 'newer') {
      pages = [...received, ...pages].slice(0, WINDOW_PAGES)
    }
    else {
      pages = received.filter(chunk => chunk.page.entries.length)
    }
    const known = new Set<string>()
    const entries: MineDiaryPage['entries'] = []
    for (const { page } of pages) {
      for (const entry of page.entries) {
        if (!known.has(entry.id)) {
          known.add(entry.id)
          entries.push(entry)
        }
      }
    }
    data.value = {
      ...fresh,
      entries,
      olderCursor: pages[pages.length - 1]?.page.olderCursor ?? null,
      newerCursor: pages[0]?.page.newerCursor ?? null,
    }
    return true
  }

  function read(direction?: 'older' | 'newer') {
    if (!direction)
      return load(pages[0]?.request ?? {}, Math.max(pages.length, 1))
    const cursor
      = direction === 'older' ? data.value?.olderCursor : data.value?.newerCursor
    return cursor && !loading.value
      ? load({ direction, cursor }, 1, direction)
      : Promise.resolve(false)
  }

  function reset() {
    pages = []
    data.value = undefined
    void read()
  }

  watch([filters, language], reset)
  watch(active, (now) => {
    if (now && (!data.value || loadedKey !== key()))
      void read()
    if (!now) {
      latest.cancel()
      loading.value = false
    }
  })
  onScopeDispose(latest.cancel)

  function jump(month?: string) {
    return load({ anchorMonth: month }, 1)
  }
  return { data, loading, error, read, jump }
}
