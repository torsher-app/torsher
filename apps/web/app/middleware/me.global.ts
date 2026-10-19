/**
 * Один запрос профиля на загрузку приложения: дальше состояние
 * берётся из useUser, а не перезапрашивается на каждом переходе.
 */
export default defineNuxtRouteMiddleware(async () => {
  const { isLoaded, fetchMe } = useUser()

  if (isLoaded.value)
    return

  await fetchMe()
})
