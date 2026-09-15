import { createContext, useContext, useEffect, useState } from 'react'
import { RpcStub } from 'capnweb'
import { PublicApi } from '@gadgets/workshop-shared/api'

// Context to provide the RPC stub and connection state throughout the app.
// The stub is wrapped in an object to avoid React's callable-state-setter issue.
export const RpcContext = createContext<{ stub: RpcStub<PublicApi>; connectionLost: boolean } | null>(null)

export function useRpcStub(): RpcStub<PublicApi> {
  const ctx = useContext(RpcContext)
  if (!ctx) throw new Error('useRpcStub must be used within RpcContext.Provider')
  return ctx.stub
}

export function useConnectionLost(): boolean {
  const ctx = useContext(RpcContext)
  return ctx?.connectionLost ?? false
}

/** How long the connection may be down before the page says so. The isolate holding the socket
 * is recycled every few minutes and the replacement connection is usually proven within a
 * couple of seconds; a notice for every one of those is noise, not information. */
export const CONNECTION_LOST_NOTICE_DELAY_MS = 5000

/** True once the connection has been down longer than the notice delay; false again the moment
 * it is restored. Use this for what people see; `useConnectionLost` stays the exact state. */
export function useConnectionLostNotice(delayMs = CONNECTION_LOST_NOTICE_DELAY_MS): boolean {
  const lost = useConnectionLost()
  const [notice, setNotice] = useState(false)
  useEffect(() => {
    if (!lost) { setNotice(false); return }
    const timer = setTimeout(() => setNotice(true), delayMs)
    return () => clearTimeout(timer)
  }, [lost, delayMs])
  return lost && notice
}
