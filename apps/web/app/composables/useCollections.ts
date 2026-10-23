import type {
  Card,
  Collection,
  CreateCollectionInput,
  UpdateCollectionInput,
} from '@torsher/api-client'
import { getErrorStatus } from '@torsher/api-client'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

const collections = shallowRef<Collection[]>([])
const state = ref<LoadState>('idle')

const collator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true,
})

function sorted(items: Collection[]) {
  return [...items].sort((a, b) => collator.compare(a.name, b.name))
}

function replace(updated: Collection) {
  collections.value = sorted(
    collections.value.map(item => (item.id === updated.id ? updated : item)),
  )
}

async function load() {
  state.value = 'loading'

  try {
    const res = await withErrorMode('silent', () =>
      api.collections.getCollections())

    collections.value = res.items
    state.value = 'ready'
  }
  catch {
    state.value = 'error'
  }
}

/** Повтор названия — ошибка поля формы, а не тост */
export function isDuplicateName(err: unknown) {
  return getErrorStatus(err) === 409
}

/** Подборки сервера: правит их владелец, витрина только кладёт в них тайтлы */
export function useCollections() {
  async function create(body: CreateCollectionInput) {
    const created = await withErrorMode('silent', () =>
      api.collections.postCollection(body))

    collections.value = sorted([...collections.value, created])

    return created
  }

  async function update(id: string, body: UpdateCollectionInput) {
    const updated = await withErrorMode('silent', () =>
      api.collections.patchCollection(id, body))

    replace(updated)

    return updated
  }

  async function remove(id: string) {
    await api.collections.deleteCollection(id)
    collections.value = collections.value.filter(item => item.id !== id)
  }

  function titlesOf(id: string, language: string): Promise<Card[]> {
    return withErrorMode('silent', () =>
      api.collections.getCollectionTitles(id, { language })).then(res => res.items)
  }

  async function removeTitle(id: string, titleId: string) {
    await api.collections.deleteCollectionTitle(id, titleId)

    const current = collections.value.find(item => item.id === id)

    if (current)
      replace({ ...current, count: Math.max(0, current.count - 1) })
  }

  return {
    collections,
    state,
    load,
    create,
    update,
    remove,
    titlesOf,
    removeTitle,
  }
}
