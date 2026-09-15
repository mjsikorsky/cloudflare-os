import { useState, useEffect, useRef } from 'react'
import type { RpcStub } from 'capnweb'
import type { PublicApi, AuthenticatedApi, ServerConfig } from '@gadgets/workshop-shared/api'
import { useConnectionConfig, useServerConfigError } from './ServerConfigContext'
import { externalLogoutUrl, externalLoginUrl } from './deploymentPaths'

const CF_ACCESS_MODE = import.meta.env.VITE_CF_ACCESS_MODE === 'true'
export { CF_ACCESS_MODE }

interface AuthState {
  owner: RpcStub<PublicApi> | null
  config: ServerConfig | null
  token: string | null
  authenticatedApi: RpcStub<AuthenticatedApi> | null
  isLoading: boolean
  error: string | null
}
interface AuthAttempt {
  api: RpcStub<AuthenticatedApi> | null
  cancelled: boolean
}
const INITIAL_AUTH: AuthState = {
  owner: null, config: null, token: null, authenticatedApi: null, isLoading: true, error: null,
}

export function useAuth(publicApi: RpcStub<PublicApi>) {
  // Admission is proven against the connection that carries it: the current connection's own
  // config, never the last known one shown by the page.
  const config = useConnectionConfig()
  const configError = useServerConfigError()
  const logoutUrl = config?.externalAuthentication?.logoutUrl
  const externallyManaged = logoutUrl !== undefined || CF_ACCESS_MODE
  // A host visitor connection carries no identity to prove; the host signs people in itself.
  const loginUrl = config?.externalAuthentication?.loginUrl
  const visitor = loginUrl !== undefined
  const [authState, setAuthState] = useState<AuthState>(INITIAL_AUTH)
  const currentAttempt = useRef<AuthAttempt | null>(null)

  function discardAttempt() {
    const attempt = currentAttempt.current
    currentAttempt.current = null
    if (attempt) {
      attempt.cancelled = true
      attempt.api?.[Symbol.dispose]()
    }
  }

  function authenticate(token: string | null) {
    discardAttempt()
    if (!config || configError) return
    const attempt: AuthAttempt = { api: null, cancelled: false }
    currentAttempt.current = attempt
    const pending: AuthState = { owner: publicApi, config, token, authenticatedApi: null, isLoading: true, error: null }
    setAuthState(pending)
    const fail = (error: unknown) => {
      if (attempt.cancelled || currentAttempt.current !== attempt) return
      discardAttempt()
      setAuthState({ ...pending, isLoading: false, error: error instanceof Error ? error.message : 'Authentication failed.' })
    }
    try {
      if (logoutUrl !== undefined) externalLogoutUrl(logoutUrl, window.location.origin)
      // Native promise pipelining sends the proof call through the unresolved admission;
      // no browser identity, token or permission is supplied for external authentication.
      const api = logoutUrl !== undefined ? publicApi.authenticateExternal()
        : CF_ACCESS_MODE ? publicApi.authenticateFromCfAccess()
        : publicApi.authenticate(token!)
      attempt.api = api
      api.onRpcBroken(fail)
      api.whoami().then(() => {
        if (attempt.cancelled || currentAttempt.current !== attempt) return
        setAuthState({ ...pending, authenticatedApi: api, isLoading: false })
      }).catch(fail)
    } catch (error) { fail(error) }
  }

  useEffect(() => {
    discardAttempt()
    if (!config || configError) return
    const token = externallyManaged ? null : localStorage.getItem('authToken')
    if (externallyManaged ? !visitor : token) authenticate(token)
    else setAuthState({ ...INITIAL_AUTH, owner: publicApi, config, isLoading: false })
    return discardAttempt
  }, [publicApi, config, configError])

  const login = (token: string) => {
    if (!externallyManaged) authenticate(token)
  }
  // Leave for the host's sign-in page; it returns the person to the current location.
  const signIn = () => {
    if (loginUrl === undefined) return false
    const url = externalLoginUrl(loginUrl, window.location.origin, window.location.href)
    const host = window.top ?? window
    host.location.assign(url)
    return true
  }
  const logout = () => {
    if (logoutUrl !== undefined) {
      const url = externalLogoutUrl(logoutUrl, window.location.origin)
      discardAttempt()
      setAuthState({ ...INITIAL_AUTH, owner: publicApi, config, isLoading: false })
      // The host owns its session; leaving only the iframe would keep the outer shell signed in.
      const host = window.top ?? window
      host.location.assign(url)
      return
    }
    if (CF_ACCESS_MODE) {
      window.location.assign('/cdn-cgi/access/logout')
      return
    }
    discardAttempt()
    setAuthState({ ...INITIAL_AUTH, owner: publicApi, config, isLoading: false })
    localStorage.removeItem('authToken')
  }

  // Never expose a capability from the old root/config during the render before effects run.
  const current = !!config && !configError && authState.owner === publicApi && authState.config === config
  const authenticatedApi = current ? authState.authenticatedApi : null
  return {
    token: current ? authState.token : null,
    authenticatedApi,
    isLoading: !configError && (!current || authState.isLoading),
    error: configError ? 'The server authentication configuration could not be loaded.' : current ? authState.error : null,
    externallyManaged, visitor, login, signIn, logout,
    isAuthenticated: !!authenticatedApi,
  }
}
