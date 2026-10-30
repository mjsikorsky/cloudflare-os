import { useEffect, useRef, useState } from 'react'
import { Button } from '@cloudflare/kumo'
import type { RpcStub } from 'capnweb'
import type { GadgetClient, Overseer, WorkpieceId } from '@gadgets/workshop-shared/api'

export type UnlockedGadget = { id: WorkpieceId; title: string; stub: RpcStub<GadgetClient> }

/** Keys admit a single gadget capability and are never persisted in workspace or device state. */
export default function GadgetKeyUnlock({ overseer, onUnlocked }: { overseer: RpcStub<Overseer>; onUnlocked(value: UnlockedGadget): void }) {
  const [id, setId] = useState(''), [key, setKey] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const generation = useRef(0)
  useEffect(() => { generation.current++; setKey(''); setMessage(''); setBusy(false); return () => { generation.current++ } }, [overseer])
  const open = async () => {
    const own = generation.current
    const gadgetId = Number(id)
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(gadgetId)) { setMessage('Enter the gadget ID supplied by its owner.'); return }
    setBusy(true); setMessage('')
    const candidate = overseer.getGadget(gadgetId, key)
    try { const title = await candidate.getTitle(); if (own !== generation.current) { candidate[Symbol.dispose](); return }; onUnlocked({ id: gadgetId, title, stub: await candidate }); setKey(''); setMessage('Gadget unlocked for this session.') }
    catch { candidate[Symbol.dispose](); if (own !== generation.current) return; setMessage('The gadget or key is not available. Ask its owner for the current key.'); setKey('') }
    finally { if (own === generation.current) setBusy(false) }
  }
  return <details className="relative"><summary className="cursor-pointer text-xs">Open key-protected gadget</summary><div className="absolute right-0 z-50 w-80 rounded border border-kumo-line bg-kumo-base p-4 shadow-lg">
    <label className="block text-xs">Gadget ID<input className="my-1 block w-full border border-kumo-line p-2" aria-label="Protected gadget ID" value={id} onChange={event => setId(event.target.value)} /></label>
    <label className="block text-xs">Access key<input type="password" autoComplete="off" className="my-1 block w-full border border-kumo-line p-2" aria-label="Gadget access key" value={key} onChange={event => setKey(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void open() } }} /></label>
    <Button disabled={busy} onClick={() => { void open() }}>Open gadget</Button>
    {message && <p role="status" className="mt-2 text-xs">{message}</p>}
  </div></details>
}
