export default defineNuxtRouteMiddleware((to) => {
  const { isAuthenticated } = useUser()

  if (!isAuthenticated.value) {
    return navigateTo({
      path: '/auth/login',
      query: { redirect: to.fullPath },
    })
  }
})
