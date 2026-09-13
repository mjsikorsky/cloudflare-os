// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { PublicApi, AuthenticatedApi, ServerConfig, AiChatAuthorInfo } from '@gadgets/workshop-shared/api'
import { useAuth } from './useAuth'
import { externalLogoutUrl } from './deploymentPaths'

const fixture = vi.hoisted(() => ({ config: null as ServerConfig | null, error: false }))
vi.mock('./ServerConfigContext', () => ({ useServerConfig: () => fixture.config, useServerConfigError: () => fixture.error }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// Isolated token storage; this suite tests admission lifecycle, not browser storage itself.
const tokens = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (key: string) => tokens.get(key) ?? null, setItem: (key: string, value: string) => tokens.set(key, value), removeItem: (key: string) => tokens.delete(key), clear: () => tokens.clear() })
const nativeConfig = { passwordAuthEnabled: true } as ServerConfig
const externalConfig = { ...nativeConfig, externalAuthentication: { logoutUrl: '/sign-out' } }
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function session() {
  const proof = deferred<AiChatAuthorInfo>()
  let broken!: (error: Error) => void
  const dispose = vi.fn()
  const api = { whoami: vi.fn(() => proof.promise), onRpcBroken: vi.fn((callback) => { broken = callback }), [Symbol.dispose]: dispose } as unknown as RpcStub<AuthenticatedApi>
  return { api, proof, dispose, break: (error: Error) => broken(error) }
}
function publicApi(auth: RpcStub<AuthenticatedApi>) {
  const methods = { authenticateExternal: vi.fn(() => auth), authenticateFromCfAccess: vi.fn(() => auth), authenticate: vi.fn(() => auth) }
  return { api: methods as unknown as RpcStub<PublicApi>, methods }
}
const profile = { id: 'person', name: 'Person', type: 'user' } as AiChatAuthorInfo

describe('native authentication admission', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined
  let state: ReturnType<typeof useAuth>
  const rendered: Array<ReturnType<typeof useAuth>> = []
  function View({ api }: { api: RpcStub<PublicApi> }) { state = useAuth(api); rendered.push(state); return null }
  async function render(api: RpcStub<PublicApi>, config: ServerConfig | null = externalConfig, error = false) {
    fixture.config = config; fixture.error = error
    if (!root) { container = document.createElement('div'); root = createRoot(container) }
    await act(async () => root!.render(<View api={api} />))
  }
  afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined; container?.remove(); rendered.length = 0
    localStorage.clear(); fixture.config = null; fixture.error = false
  })
  it('waits for configuration, ignores stored tokens in external mode, and confirms admission through pipelined whoami', async () => {
    const auth = session(), publicRoot = publicApi(auth.api)
    localStorage.setItem('authToken', 'old-native-token')
    await render(publicRoot.api, null)
    expect(publicRoot.methods.authenticateExternal).not.toHaveBeenCalled()
    expect(state!.isLoading).toBe(true)
    await render(publicRoot.api)
    expect(publicRoot.methods.authenticateExternal).toHaveBeenCalledWith()
    expect(publicRoot.methods.authenticate).not.toHaveBeenCalled()
    expect(publicRoot.methods.authenticateFromCfAccess).not.toHaveBeenCalled()
    expect(auth.api.whoami).toHaveBeenCalledOnce()
    expect(state!.isAuthenticated).toBe(false)
    await act(async () => auth.proof.resolve(profile))
    expect(state!.authenticatedApi).toBe(auth.api)
    expect(state!.isLoading).toBe(false)
  })
  it('surfaces an expired admission and disposes the rejected capability', async () => {
    const auth = session(), publicRoot = publicApi(auth.api)
    await render(publicRoot.api)
    await act(async () => auth.proof.reject(new Error('Host admission expired.')))
    expect(state!.isAuthenticated).toBe(false)
    expect(state!.isLoading).toBe(false)
    expect(state!.error).toBe('Host admission expired.')
    expect(auth.dispose).toHaveBeenCalledOnce()
  })
  it('never accepts a delayed proof from a previous connection', async () => {
    const first = session(), second = session()
    const firstRoot = publicApi(first.api), secondRoot = publicApi(second.api)
    await render(firstRoot.api)
    await render(secondRoot.api, null)
    expect(first.dispose).toHaveBeenCalledOnce()
    await act(async () => first.proof.resolve(profile))
    expect(state!.authenticatedApi).toBeNull()
    await render(secondRoot.api)
    await act(async () => second.proof.resolve(profile))
    expect(state!.authenticatedApi).toBe(second.api)
    expect(rendered.every(value => value.authenticatedApi !== first.api)).toBe(true)
  })
  it('hides the previous confirmed session immediately on a new root, before effects', async () => {
    const first = session(), second = session()
    const firstRoot = publicApi(first.api), secondRoot = publicApi(second.api)
    await render(firstRoot.api)
    await act(async () => first.proof.resolve(profile))
    const before = rendered.length
    await render(secondRoot.api)
    expect(rendered.slice(before).every(value => value.authenticatedApi === null)).toBe(true)
    expect(first.dispose).toHaveBeenCalledOnce()
  })
  it('revokes a confirmed session when its RPC capability breaks', async () => {
    const auth = session(), publicRoot = publicApi(auth.api)
    await render(publicRoot.api)
    await act(async () => auth.proof.resolve(profile))
    await act(async () => auth.break(new Error('Disconnected')))
    expect(state!.authenticatedApi).toBeNull()
    expect(state!.error).toBe('Disconnected')
    expect(auth.dispose).toHaveBeenCalledOnce()
  })
  it('preserves native stored-token admission and local logout', async () => {
    const auth = session(), publicRoot = publicApi(auth.api)
    localStorage.setItem('authToken', 'native-token')
    await render(publicRoot.api, nativeConfig)
    expect(publicRoot.methods.authenticate).toHaveBeenCalledWith('native-token')
    expect(publicRoot.methods.authenticateExternal).not.toHaveBeenCalled()
    await act(async () => auth.proof.resolve(profile))
    await act(async () => state!.logout())
    expect(state!.isAuthenticated).toBe(false)
    expect(localStorage.getItem('authToken')).toBeNull()
    expect(auth.dispose).toHaveBeenCalledOnce()
  })
  it('allows explicit native login without a stored session and rejects token fallback in host mode', async () => {
    const auth = session(), publicRoot = publicApi(auth.api)
    await render(publicRoot.api, nativeConfig)
    expect(state!.isLoading).toBe(false)
    await act(async () => state!.login('new-token'))
    expect(publicRoot.methods.authenticate).toHaveBeenCalledWith('new-token')
    await render(publicRoot.api)
    await act(async () => state!.login('forged-fallback'))
    expect(publicRoot.methods.authenticate).toHaveBeenCalledTimes(1)
  })
  it('surfaces configuration failure without attempting token fallback', async () => {
    const auth = session(), publicRoot = publicApi(auth.api)
    localStorage.setItem('authToken', 'native-token')
    await render(publicRoot.api, null, true)
    expect(state!.isLoading).toBe(false)
    expect(state!.error).toContain('configuration')
    expect(publicRoot.methods.authenticate).not.toHaveBeenCalled()
  })
  it('refuses invalid external logout configuration before minting a session', async () => {
    const auth = session(), publicRoot = publicApi(auth.api)
    await render(publicRoot.api, { ...externalConfig, externalAuthentication: { logoutUrl: 'https://other.test/sign-out' } })
    expect(publicRoot.methods.authenticateExternal).not.toHaveBeenCalled()
    expect(state!.isLoading).toBe(false)
    expect(state!.error).toContain('this origin')
  })
  it('limits host sign-out navigation to the current origin', () => {
    expect(externalLogoutUrl('/sign-out', 'https://platform.example')).toBe('https://platform.example/sign-out')
    for (const value of ['//other.example/sign-out', 'javascript:alert(1)', 'https://user:pass@platform.example/sign-out']) {
      expect(() => externalLogoutUrl(value, 'https://platform.example')).toThrow()
    }
  })
})
