import { useEffect, useRef, useState } from 'react'
import { Button } from '@cloudflare/kumo'
import type { RpcStub } from 'capnweb'
import type { GadgetClient } from '@gadgets/workshop-shared/api'

/** Owner controls the OS admission policy; raw keys exist only in this browser interaction. */
export default function GadgetAccessControl({ gadget }: { gadget: RpcStub<GadgetClient> | null }) {
  const generation = useRef(0)
  const [mode, setMode] = useState<'workspace' | 'key' | null>(null)
  const [key, setKey] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    generation.current++; let current = true; setBusy(false); setMode(null); setKey(''); setMessage('')
    if (gadget) void gadget.getAccessMode().then(value => { if (current) setMode(value) }, () => { if (current) setMessage('Gadget access could not be read.') })
    return () => { current = false; generation.current++ }
  }, [gadget])
  const update = async (locked: boolean) => {
    if (!gadget) return
    const own = generation.current
    const nextKey = locked ? btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : ''
    setBusy(true); setMessage(''); setKey('')
    try {
      await gadget.setAccess(locked ? { visibility: 'key', key: nextKey } : { visibility: 'workspace' })
      if (own !== generation.current) return
      setMode(locked ? 'key' : 'workspace'); setKey(nextKey)
      setMessage(locked ? 'Copy this key now. Workshop stores only its digest. Existing gadget connections were revoked.' : 'This gadget is shared with workspace users. Existing gadget connections were restarted.')
    } catch (error) { if (own !== generation.current) return; setMessage(error instanceof Error ? error.message : 'Only the workspace owner can change gadget access.') }
    finally { if (own === generation.current) setBusy(false) }
  }
  return <details className="relative"><summary className="cursor-pointer text-xs">Gadget access{mode === 'key' ? ' · Key required' : ''}</summary><div className="absolute right-0 z-50 w-80 rounded border border-kumo-line bg-kumo-base p-4 shadow-lg">
    <p className="text-sm">{mode === 'key' ? 'Workspace users need this gadget’s key.' : 'Workspace users can open this gadget.'}</p>
    <p className="my-2 text-xs text-kumo-subtle">Owners and build editors remain trusted with workspace code and data. Only the owner can change access.</p>
    <div className="flex flex-wrap gap-2"><Button disabled={!mode || busy} onClick={() => { void update(true) }}>{mode === 'key' ? 'Rotate key' : 'Lock and create key'}</Button>{mode === 'key' && <Button disabled={busy} onClick={() => { void update(false) }}>Share with workspace</Button>}</div>
    {key && <label className="mt-3 block text-xs">New gadget key<input className="mt-1 w-full border border-kumo-line p-2" aria-label="New gadget key" value={key} readOnly onFocus={event => event.currentTarget.select()} /></label>}
    {message && <p role="status" className="mt-2 text-xs">{message}</p>}
  </div></details>
}
