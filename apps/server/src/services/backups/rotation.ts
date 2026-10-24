import type { BackupName, BackupReason } from './names.ts'

// Копии перед обновлением, восстановлением и импортом: хватает трёх последних
const KEEP_PER_REASON = 3
const KEEP_LAST: BackupReason[] = ['pre-update', 'pre-restore', 'pre-import']

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/** Год и номер ISO-недели по местной дате: неделя с понедельника */
function isoWeekKey(date: Date) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const weekday = (day.getDay() + 6) % 7

  // Четверг той же недели определяет её год
  day.setDate(day.getDate() - weekday + 3)

  const firstThursday = new Date(day.getFullYear(), 0, 4)
  const firstWeekday = (firstThursday.getDay() + 6) % 7

  firstThursday.setDate(firstThursday.getDate() - firstWeekday + 3)

  const week
    = 1 + Math.round((day.getTime() - firstThursday.getTime()) / (7 * 864e5))

  return `${day.getFullYear()}-W${week}`
}

function newestFirst(items: BackupName[]) {
  return [...items].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )
}

/**
 * Плановые: самая новая копия каждого из `daily` последних дней, в которые
 * копии есть, затем самая новая каждой из `weekly` более ранних ISO-недель.
 * Дни и недели — по местному времени процесса.
 */
function scheduledToDelete(
  items: BackupName[],
  keep: { daily: number, weekly: number },
) {
  const sorted = newestFirst(items)
  const kept = new Set<string>()
  const days = new Set<string>()
  let oldestDaily: BackupName | undefined

  for (const item of sorted) {
    if (days.size >= keep.daily)
      break

    const key = dayKey(item.createdAt)

    if (days.has(key))
      continue

    days.add(key)
    kept.add(item.name)
    oldestDaily = item
  }

  const weeks = new Set<string>()
  const dailyWeek = oldestDaily ? isoWeekKey(oldestDaily.createdAt) : undefined

  for (const item of sorted) {
    if (weeks.size >= keep.weekly)
      break

    if (oldestDaily && item.createdAt >= oldestDaily.createdAt)
      continue

    const key = isoWeekKey(item.createdAt)

    if (key === dailyWeek || weeks.has(key))
      continue

    weeks.add(key)
    kept.add(item.name)
  }

  return sorted.filter(item => !kept.has(item.name)).map(item => item.name)
}

/**
 * Какие копии удалить после успешной копии. Ручные, загруженные и чужие
 * файлы (не по шаблону имени сюда не попадают) не удаляются никогда.
 */
export function selectForDeletion(
  items: BackupName[],
  keep: { daily: number, weekly: number },
) {
  const result = scheduledToDelete(
    items.filter(item => item.reason === 'scheduled'),
    keep,
  )

  for (const reason of KEEP_LAST) {
    const old = newestFirst(
      items.filter(item => item.reason === reason),
    ).slice(KEEP_PER_REASON)

    result.push(...old.map(item => item.name))
  }

  return result
}
