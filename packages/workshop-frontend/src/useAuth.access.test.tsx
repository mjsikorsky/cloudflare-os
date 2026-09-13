// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { PublicApi, AuthenticatedApi, ServerConfig } from '@gadgets/workshop-shared/api'
vi.stubEnv('VITE_CF_ACCESS_MODE', 'true')
const config = vi.hoisted(() => ({} as ServerConfig))
vi.mock('./ServerConfigContext', () => ({ useServerConfig: () => config, useServerConfigError: () => false }))
const { useAuth } = await import('./useAuth')
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('retains native Cloudflare Access admission when the server does not advertise a host', async () => {
  const dispose = vi.fn()
  const auth = { whoami: () => Promise.resolve({ id: 'person' }), onRpcBroken() {}, [Symbol.dispose]: dispose } as unknown as RpcStub<AuthenticatedApi>
  const methods = { authenticateFromCfAccess: vi.fn(() => auth), authenticateExternal: vi.fn(), authenticate: vi.fn() }
  let state!: ReturnType<typeof useAuth>
  function View() { state = useAuth(methods as unknown as RpcStub<PublicApi>); return null }
  const container = document.createElement('div'), root = createRoot(container)
  try {
    await act(async () => root.render(<View />))
    expect(methods.authenticateFromCfAccess).toHaveBeenCalledWith()
    expect(methods.authenticateExternal).not.toHaveBeenCalled()
    expect(methods.authenticate).not.toHaveBeenCalled()
    expect(state.isAuthenticated).toBe(true)
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllEnvs() }
  expect(dispose).toHaveBeenCalledOnce()
})
