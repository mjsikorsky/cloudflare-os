import { useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { GadgetClient, Overseer, WorkpieceId } from '@gadgets/workshop-shared/api'

/** Own the child capability with its parent connection, including the render before effects run.
 *
 * When the parent connection is replaced (a reconnect swaps the overseer stub), the previous child
 * is still returned until the effect has opened its replacement: the child's consumers keep their
 * mounted state and swap stubs in place (GadgetUI reconnects `connectToGadget` on the new stub and
 * suspends calls in between), instead of tearing down and reloading on every reconnect. Only a
 * different workpiece, or no parent at all, yields null. */
export function useGadgetClient(owner: RpcStub<Overseer> | null, id: WorkpieceId | null): RpcStub<GadgetClient> | null {
  const [opened, setOpened] = useState<{ owner: RpcStub<Overseer>; id: WorkpieceId; stub: RpcStub<GadgetClient> } | null>(null)
  useEffect(() => {
    if (!owner || id === null) {
      setOpened(null)
      return
    }
    // getGadget pipelines; callers retain the native RPC behavior without a probe round trip.
    const stub = owner.getGadget(id)
    setOpened({ owner, id, stub })
    return () => { stub[Symbol.dispose]() }
  }, [owner, id])
  return owner && opened?.id === id ? opened.stub : null
}
