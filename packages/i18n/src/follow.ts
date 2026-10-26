import type { Language } from './language.ts'

type Translate = (
  key: string,
  params?: Record<string, string | number | undefined>,
  count?: number,
) => string

/** Озвучка и качество раздачи: что вышло, что взяли, чего ждём */
export interface FollowReleaseFacts {
  studio?: string
  voiceType?: string
  quality?: string
}

/** Параметры события «Следить» — как их пишет сервер в центр уведомлений */
export interface FollowNotificationParams extends FollowReleaseFacts {
  // Название тайтла на языках интерфейса на момент события
  names?: Partial<Record<Language, string>>
  // Серии строкой: «S1E10, S2E1–E2»; у фильма пусто
  episodes?: string
  count?: number
  season?: number
  // Чего ждёт отложенная серия и до какого момента (ISO)
  wait?: FollowReleaseFacts
  until?: string
  // Своя студия сезона: её ждёт серия, взятая в другой озвучке
  own?: string
  // Обновлённая тема: последняя серия и «из N»
  episodesTo?: number
  episodesTotal?: number
  // Сколько дней назад вышла серия, раздач которой нет
  days?: number
}

export const followNotificationKinds = [
  'follow_downloaded',
  'follow_ready',
  'follow_waiting',
  'follow_other_voice',
  'follow_upgraded',
  'follow_topic_updated',
  'follow_missing',
] as const

export type FollowNotificationKind = (typeof followNotificationKinds)[number]

export function isFollowNotification(
  kind: string,
): kind is FollowNotificationKind {
  return (followNotificationKinds as readonly string[]).includes(kind)
}

const ROOT = 'notifications.follow'

/** «Сегодня 20:00» — только часы, иначе с датой */
export function formatFollowUntil(
  iso: string,
  language: Language,
  now = Date.now(),
) {
  const date = new Date(iso)
  const sameDay = date.toDateString() === new Date(now).toDateString()

  return new Intl.DateTimeFormat(
    language.replace('_', '-'),
    sameDay
      ? { timeStyle: 'short' }
      : {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: 'numeric',
          minute: '2-digit',
        },
  ).format(date)
}

/**
 * Заголовок и текст события «Следить» на языке панели или канала: общий для
 * центра уведомлений и сообщений сервера. Студии и качество — из данных
 * раздачи, названий источников от себя здесь нет.
 */
export function followNotificationText(
  t: Translate,
  language: Language,
  kind: FollowNotificationKind,
  params: FollowNotificationParams,
  now = Date.now(),
) {
  const count = params.count ?? 1
  const movie = !params.episodes
  const name
    = params.names?.[language] ?? params.names?.en_US ?? params.names?.ru_RU
  const quoted = name ? t(`${ROOT}.quoted`, { title: name }) : ''
  const subject
    = [quoted, params.episodes].filter(Boolean).join(' · ')
      || t(`${ROOT}.unknownTitle`)

  function facts(value: FollowReleaseFacts | undefined, joiner = ' · ') {
    const voiceType = value?.voiceType
      ? t(`sources.voiceTypes.${value.voiceType}`)
      : undefined

    return [
      value?.studio,
      // Нет строки для типа — сам код, а не ключ
      voiceType && !voiceType.startsWith('sources.')
        ? voiceType
        : value?.voiceType,
      value?.quality,
    ]
      .filter(Boolean)
      .join(joiner)
  }

  const title = (key: string, plural?: number) =>
    plural === undefined
      ? t(`${ROOT}.${key}`)
      : t(`${ROOT}.${key}`, { n: plural }, plural)
  const line = (...parts: string[]) => parts.filter(Boolean).join(' · ')

  switch (kind) {
    case 'follow_downloaded':
      return {
        title: movie
          ? title('downloaded.titleMovie')
          : title('downloaded.title', count),
        text: line(subject, facts(params)),
      }
    case 'follow_ready':
      return {
        title: movie ? title('ready.titleMovie') : title('ready.title', count),
        text: line(subject, facts(params)),
      }
    case 'follow_upgraded':
      return {
        title: title('upgraded.title'),
        text: line(subject, facts(params)),
      }
    case 'follow_waiting': {
      const wait = params.wait ?? {}
      const found = facts(params)
      const values = {
        subject,
        found,
        target: facts(wait, t(`${ROOT}.and`)),
        until: params.until
          ? formatFollowUntil(params.until, language, now)
          : '',
      }

      return {
        title: title(
          wait.studio || wait.voiceType
            ? 'waiting.titleVoice'
            : 'waiting.titleQuality',
        ),
        text: !found
          ? t(`${ROOT}.waiting.textPlain`, values)
          : movie
            ? t(`${ROOT}.waiting.textMovie`, values)
            : t(`${ROOT}.waiting.text`, { ...values, n: count }, count),
      }
    }
    case 'follow_other_voice': {
      const taken = facts(params)
      const values = { subject, taken, own: params.own }

      return {
        title: title('otherVoice.title'),
        text: taken
          ? t(`${ROOT}.otherVoice.text`, values)
          : t(`${ROOT}.otherVoice.textPlain`, values),
      }
    }
    case 'follow_topic_updated': {
      const values = {
        title: quoted || t(`${ROOT}.unknownTitle`),
        season: params.season,
        to: params.episodesTo,
        total: params.episodesTotal,
      }

      return {
        title: title('topicUpdated.title'),
        text:
          params.episodesTo === undefined
            ? t(`${ROOT}.topicUpdated.textSeason`, values)
            : params.episodesTotal === undefined
              ? t(`${ROOT}.topicUpdated.textTo`, values)
              : t(`${ROOT}.topicUpdated.text`, values),
      }
    }
    case 'follow_missing':
      return {
        title: title('missing.title'),
        text:
          params.days !== undefined && count === 1
            ? t(
                `${ROOT}.missing.textDays`,
                { subject, n: params.days },
                params.days,
              )
            : t(`${ROOT}.missing.text`, { subject, n: count }, count),
      }
  }
}
