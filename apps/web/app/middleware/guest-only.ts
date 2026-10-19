export default defineNuxtRouteMiddleware(() => {
  const { isAuthenticated } = useUser()

  if (isAuthenticated.value)
    return navigateTo('/')
})
