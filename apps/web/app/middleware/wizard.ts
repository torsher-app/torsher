import { wizardPath } from '~/composables/useWizard'

/** Шаги мастера после аккаунта: пройденный мастер уводит в панель, кроме «Готово» */
export default defineNuxtRouteMiddleware(async (to) => {
  const wizard = await useWizard().load()

  if (!wizard?.active && to.path !== wizardPath('done'))
    return navigateTo('/')
})
