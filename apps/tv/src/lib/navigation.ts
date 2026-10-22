import type { Router } from 'vue-router'

/** Что нужно от маршрута, чтобы найти экран уровнем выше */
export interface RouteLike {
  /** Шаблон маршрута: `/title/:id/sources` */
  pattern: string
  params: Record<string, string | string[] | undefined>
  query: Record<string, unknown>
}

export type BackAction
  = { kind: 'history' } | { kind: 'replace', path: string } | { kind: 'none' }

function pathOf(location: string) {
  return location.split('?')[0] ?? ''
}

function stringOf(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

/**
 * Экран уровнем выше и какая прошлая запись истории им считается. Флоу
 * просмотра — иерархия: плеер → «Файлы» → «Источники» → карточка → откуда
 * пришли на карточку. Остальные экраны родителя не знают.
 */
function parentOf(route: RouteLike) {
  const id = stringOf(route.params.id)

  switch (route.pattern) {
    case '/title/:id/files/:torrentId':
      return {
        path: `/title/${id}/sources`,
        accepts: (back: string) => pathOf(back) === `/title/${id}/sources`,
      }
    case '/title/:id/sources':
      return {
        path: `/title/${id}`,
        accepts: (back: string) => pathOf(back) === `/title/${id}`,
      }
    case '/title/:id':
      // Назад — туда, откуда открыли карточку (главная, поиск, другая карточка),
      // но не в её же экраны просмотра
      return {
        path: '/',
        accepts: (back: string) =>
          !pathOf(back).startsWith(`/title/${id}/`)
          && !back.startsWith('/play/'),
      }
    case '/play/:torrentId/:fileIndex': {
      const title = stringOf(route.query.title)

      if (!title)
        return undefined

      const files = `/title/${title}/files/${stringOf(route.params.torrentId)}`

      return {
        path: files,
        accepts: (back: string) => pathOf(back) === files,
      }
    }
    default:
      return undefined
  }
}

/**
 * Back — подъём на экран выше, а не отмена последнего перехода. Если прошлая
 * запись истории и есть родитель, шагаем назад по истории; иначе заменяем
 * текущую запись родителем. `push` тут создал бы петлю: у новой записи «назад»
 * указывал бы на дочерний экран, и следующий Back вернул бы в него.
 */
export function backAction(route: RouteLike, back: unknown): BackAction {
  const previous = stringOf(back)
  const parent = parentOf(route)

  if (!parent)
    return previous ? { kind: 'history' } : { kind: 'none' }

  return previous && parent.accepts(previous)
    ? { kind: 'history' }
    : { kind: 'replace', path: parent.path }
}

/**
 * Back с пульта и кнопка «Назад» экранов: на экран выше (`backAction`).
 * `onRoot` — когда выше некуда: на ТВ выход из приложения.
 */
export function goBack(router: Router, onRoot?: () => void) {
  const route = router.currentRoute.value
  const action = backAction(
    {
      pattern: route.matched[route.matched.length - 1]?.path ?? route.path,
      params: route.params,
      query: route.query,
    },
    router.options.history.state.back,
  )

  if (action.kind === 'history')
    router.back()
  // Родитель встаёт на место текущей записи без ссылки «назад» на дочерний экран
  else if (action.kind === 'replace')
    void router.replace({ path: action.path, state: { back: null } })
  else onRoot?.()
}

/**
 * Экран открыт шагом вперёд, а не возвратом с дочернего: у записи истории нет
 * «вперёд» (на неё не вернулись `router.back()`) и есть «назад» (её не подставил
 * `goBack` на место дочерней). `state` — `history.state` записи vue-router.
 */
export function openedForward(state: { back?: unknown, forward?: unknown }) {
  return Boolean(stringOf(state.back)) && !stringOf(state.forward)
}
