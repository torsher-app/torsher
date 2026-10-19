import type { SigninInput, SignupInput } from '@torsher/api-client'
import { api } from '~/services/api'

export function useAuth() {
  const { fetchMe, reset } = useUser()

  async function signin(body: SigninInput) {
    await api.auth.postAuthSignin(body)
    await fetchMe()
    await navigateTo('/')
  }

  async function signup(body: SignupInput) {
    await api.auth.postAuthSignup(body)
    await signin({ email: body.email, password: body.password })
  }

  /** Сессия истекла: чистим состояние и уводим на вход */
  async function clearSession() {
    reset()
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
