// @vitest-environment jsdom
import React from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { PublicApi, ServerConfig } from '@gadgets/workshop-shared/api'
import { useServerConfigConnection } from './useServerConfigConnection'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('never uses stale configuration or a late reply for a replacement RPC root', async () => {
  function connection() {
    let resolve!: (config: ServerConfig) => void, reject!: (error: Error) => void
    const promise = new Promise<ServerConfig>((yes, no) => { resolve = yes; reject = no })
    return { owner: { getServerConfig: () => promise } as unknown as RpcStub<PublicApi>, resolve, reject }
  }
  const first = connection(), second = connection(), third = connection()
  let state!: ReturnType<typeof useServerConfigConnection>
  function View({ owner }: { owner: RpcStub<PublicApi> }) { state = useServerConfigConnection(owner); return null }
  const container = document.createElement('div'), root = createRoot(container)
  try {
    await React.act(async () => root.render(<View owner={first.owner} />))
    await React.act(async () => root.render(<View owner={second.owner} />))
    await React.act(async () => first.resolve({ externalAuthentication: { logoutUrl: '/wrong-session' } } as ServerConfig))
    expect(state.config).toBeNull()
    expect(state.lastKnown).toBeNull()
    const currentConfig = { siteName: 'Current native server' } as ServerConfig
    await React.act(async () => second.resolve(currentConfig))
    expect(state.config).toBe(currentConfig)
    expect(state.lastKnown).toBe(currentConfig)
    await React.act(async () => root.render(<View owner={third.owner} />))
    expect(state.config).toBeNull()
    // The page keeps showing what it last knew while the replacement connection answers.
    expect(state.lastKnown).toBe(currentConfig)
    await React.act(async () => third.reject(new Error('Disconnected')))
    expect(state.config).toBeNull()
    expect(state.error).toBe(true)
    expect(state.lastKnown).toBe(currentConfig)
  } finally { await React.act(async () => root.unmount()); container.remove() }
})
