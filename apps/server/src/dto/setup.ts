import { z } from 'zod'

// Шаги после аккаунта: аккаунт создаётся до входа и в состоянии не хранится
export const wizardSteps = ['storage', 'network', 'sources', 'done'] as const

export const wizardState = z
  .object({
    // Мастер не завершён и не пропущен: панель после входа ведёт в него
    active: z.boolean(),
    step: z.enum(wizardSteps),
    skipped: z.array(z.enum(wizardSteps)),
    completedAt: z.string().nullable(),
  })
  .meta({ id: 'wizardState' })

export const updateWizard = z
  .object({
    step: z.enum(wizardSteps),
    skipped: z.array(z.enum(wizardSteps)).max(wizardSteps.length),
    // Мастер пройден или пропущен целиком: больше в него не ведём
    completed: z.boolean(),
  })
  .meta({ id: 'updateWizard' })

export const storageDirCheck = z
  .object({
    path: z.string(),
    // Каталога нет: его создаст сервер, запись проверена в ближайшем родителе
    exists: z.boolean(),
    writable: z.boolean(),
  })
  .meta({ id: 'storageDirCheck' })

export const spaceStatuses = ['ok', 'low', 'critical'] as const

// Как «Оставить» кладёт файл из загрузок в библиотеку: хардлинк и reflink
// места не занимают, копия занимает его, пока раздачу не вытеснят из кэша
export const libraryLinkModes = ['hardlink', 'reflink', 'copy'] as const

export const storageCheck = z
  .object({
    data: storageDirCheck,
    downloads: storageDirCheck,
    library: storageDirCheck,
    // null — каталоги недоступны для записи
    linkMode: z.enum(libraryLinkModes).nullable(),
    space: z.object({
      total: z.number(),
      free: z.number(),
      // low — лимит кэша не поместится над запасом, critical — свободно меньше запаса
      status: z.enum(spaceStatuses),
    }),
  })
  .meta({ id: 'storageCheck' })

export const discoveredManager = z
  .object({
    kind: z.enum(['prowlarr', 'jackett']),
    url: z.string(),
  })
  .meta({ id: 'discoveredManager' })

export const discoverManagersResult = z
  .object({
    items: z.array(discoveredManager),
  })
  .meta({ id: 'discoverManagersResult' })
