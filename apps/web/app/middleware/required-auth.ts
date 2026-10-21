import { wizardPath } from '~/composables/useWizard'

export default defineNuxtRouteMiddleware(async (to) => {
  const { isAuthenticated } = useUser()

  if (!isAuthenticated.value) {
    return navigateTo({
      path: '/auth/login',
      query: { redirect: to.fullPath },
    })
  }

  // Пока мастер первого запуска не пройден и не пропущен, панель ведёт в него
  if (!to.meta.wizardStep) {
    const wizard = await useWizard().load()

    if (wizard?.active)
      return navigateTo(wizardPath(wizard.step))
  }
})
