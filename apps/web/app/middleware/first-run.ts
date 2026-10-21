const SETUP_PATH = '/auth/setup'

/** На ненастроенном сервере вход ведёт на создание аккаунта, на настроенном — наоборот */
export default defineNuxtRouteMiddleware(async (to) => {
  const needsSetup = await useSetup().load()

  if (needsSetup && to.path !== SETUP_PATH)
    return navigateTo(SETUP_PATH)

  if (!needsSetup && to.path === SETUP_PATH)
    return navigateTo('/auth/login')
})
