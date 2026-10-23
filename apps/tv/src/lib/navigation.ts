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

const HOME = '/'

/** Разделы рейла, кроме главной: их родитель — главная */
const SECTIONS = new Set([
  '/movies',
  '/series',
  '/library',
  '/search',
  '/mine',
  '/settings',
  '/about',
])

/**
 * Каталог — раздел рейла, но его открывают и чипы карточки тайтла: тогда
 * назад — в карточку (или персону), откуда пришли
 */
const CATALOG = '/catalog'

/** Выбор тайтла для раздачи: открывают из «Библиотеки», назад — туда */
const LIBRARY_PICK = '/library/pick'

/** Домашнее видео открывают из «Библиотеки»: назад — туда; альбом — к альбомам */
const HOME_VIDEO = '/home-video'
const HOME_VIDEO_ALBUM = '/home-video/album'

/**
 * Экран уровнем выше и какая прошлая запись истории им считается. Флоу
 * просмотра — иерархия: плеер → «Файлы» → «Источники» → карточка → откуда
 * пришли на карточку. Персона, как и карточка, возвращается туда, откуда её
 * открыли. Разделы рейла — на главную. Остальные экраны родителя не знают.
 */
function parentOf(route: RouteLike) {
  const id = stringOf(route.params.id)

  if (route.pattern === HOME_VIDEO) {
    return {
      path: '/library',
      accepts: (back: string) => pathOf(back) === '/library',
    }
  }

  if (route.pattern === HOME_VIDEO_ALBUM) {
    return {
      path: '/home-video',
      accepts: (back: string) => pathOf(back) === '/home-video',
    }
  }

  if (route.pattern === LIBRARY_PICK) {
    return {
      path: '/library',
      accepts: (back: string) => pathOf(back) === '/library',
    }
  }

  if (SECTIONS.has(route.pattern)) {
    return {
      path: HOME,
      accepts: (back: string) => pathOf(back) === HOME,
    }
  }

  if (route.pattern === CATALOG) {
    return {
      path: HOME,
      accepts: (back: string) => {
        const path = pathOf(back)

        return (
          path === HOME
          || /^\/title\/[^/]+$/.test(path)
          || path.startsWith('/person/')
        )
      },
    }
  }

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
        path: HOME,
        accepts: (back: string) =>
          !pathOf(back).startsWith(`/title/${id}/`)
          && !back.startsWith('/play/'),
      }
    case '/person/:id':
      // Персону открывают из карточки, поиска или другой персоны: назад — туда
      return { path: '/', accepts: () => true }
    case '/play/library/:mediaFileId': {
      const title = stringOf(route.query.title)

      if (!title)
        return undefined

      // Файл библиотеки открывают с карточки («Смотреть»), из «Источников»
      // (строка «В библиотеке») и с главной («Продолжить»): назад — туда
      const card = `/title/${title}`

      return {
        path: card,
        accepts: (back: string) => {
          const path = pathOf(back)

          return (
            path === card
            || path === `${card}/sources`
            || (!path.startsWith(`${card}/`) && !path.startsWith('/play/'))
          )
        },
      }
    }
    case '/play/:torrentId/:fileIndex': {
      const title = stringOf(route.query.title)

      if (!title)
        return undefined

      const files = `/title/${title}/files/${stringOf(route.params.torrentId)}`
      const flow = `/title/${title}/`

      // Раздачу из одного файла «Файлы» пропускают: плеер встаёт на их место,
      // и прошлая запись — «Источники». «Продолжить» открывает плеер с главной
      // и с карточки — туда и назад. «Файлы» другой раздачи (серию сменили в
      // плеере) не годятся: родитель — «Файлы» той, что смотрят
      return {
        path: files,
        accepts: (back: string) => {
          const path = pathOf(back)

          return (
            path === files
            || path === `${flow}sources`
            || (!path.startsWith(flow) && !path.startsWith('/play/'))
          )
        },
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
  // Главная — корень: Back с неё — `onRoot`, даже если в истории до неё есть
  // записи (прошлый раздел, карточка или плеер, открытые ссылкой)
  if (route.pattern === HOME)
    return { kind: 'none' }

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
 * На запись истории вернулись `router.back()` с экрана впереди: у неё есть
 * «вперёд». `state` — `history.state` записи vue-router.
 */
export function returnedBack(state: { forward?: unknown }) {
  return Boolean(stringOf(state.forward))
}

/**
 * Экран открыт шагом вперёд, а не возвратом с дочернего: на запись не
 * вернулись (`returnedBack`) и у неё есть «назад» (её не подставил `goBack` на
 * место дочерней).
 */
export function openedForward(state: { back?: unknown, forward?: unknown }) {
  return Boolean(stringOf(state.back)) && !returnedBack(state)
}
