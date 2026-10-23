import type { SigninInput, SignupInput } from '@torsher/api-client'
import { returnPath } from '~/lib/redirect'
import { api } from '~/services/api'

export function useAuth() {
  const { fetchMe, reset } = useUser()
  const { markDone } = useSetup()
  const wizard = useWizard()
  const { tvUrl } = useRuntimeConfig().public

  async function signin(body: SigninInput) {
    await api.auth.postAuthSignin(body)
    await fetchMe()

    // Вход ради витрины: уходим из панели целиком, роутер туда не ведёт
    const next = returnPath(
      new URLSearchParams(window.location.search).get('next'),
    )
    if (next) {
      // Путь — на origin витрины: в разработке у неё свой dev-сервер
      window.location.assign(
        new URL(next, new URL(tvUrl, window.location.href)),
      )
      return
    }

    await navigateTo('/')
  }

  async function signup(body: SignupInput) {
    await api.auth.postAuthSignup(body)
    markDone()
    await signin({ email: body.email, password: body.password })
  }

  /** Сессия истекла: чистим состояние и уводим на вход */
  async function clearSession() {
    reset()
    wizard.reset()
    await navigateTo('/auth/login')
  }

  async function logout() {
    await withErrorMode('silent', () => api.auth.postAuthLogout()).catch(
      () => undefined,
    )

    await clearSession()
  }

  return { signin, signup, logout, clearSession }
}
