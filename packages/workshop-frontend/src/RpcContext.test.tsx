// @vitest-environment jsdom
import React from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { PublicApi } from '@gadgets/workshop-shared/api'
import { RpcContext, useConnectionLost, useConnectionLostNotice, CONNECTION_LOST_NOTICE_DELAY_MS } from './RpcContext'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

it('says nothing about a connection that comes back within the notice delay, and clears at once when it does', async () => {
  const stub = {} as RpcStub<PublicApi>
  let seen!: { exact: boolean; notice: boolean }
  function View() { seen = { exact: useConnectionLost(), notice: useConnectionLostNotice() }; return null }
  const container = document.createElement('div'), root = createRoot(container)
  const render = (connectionLost: boolean) => React.act(async () => root.render(
    <RpcContext.Provider value={{ stub, connectionLost }}><View /></RpcContext.Provider>))
  try {
    await render(false)
    expect(seen).toEqual({ exact: false, notice: false })
    await render(true)
    expect(seen).toEqual({ exact: true, notice: false })
    await React.act(async () => { vi.advanceTimersByTime(CONNECTION_LOST_NOTICE_DELAY_MS - 1) })
    expect(seen.notice).toBe(false)
    // A short blip: restored before the delay elapses — no notice was ever shown.
    await render(false)
    await React.act(async () => { vi.advanceTimersByTime(CONNECTION_LOST_NOTICE_DELAY_MS * 2) })
    expect(seen).toEqual({ exact: false, notice: false })
    // A real outage: the notice appears after the delay and clears the moment the connection is back.
    await render(true)
    await React.act(async () => { vi.advanceTimersByTime(CONNECTION_LOST_NOTICE_DELAY_MS) })
    expect(seen).toEqual({ exact: true, notice: true })
    await render(false)
    expect(seen).toEqual({ exact: false, notice: false })
  } finally { await React.act(async () => root.unmount()); container.remove() }
})
