import { useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { GadgetClient, Overseer, WorkpieceId } from '@gadgets/workshop-shared/api'

/** Own the child capability with its parent connection, including the render before effects run. */
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
  return opened?.owner === owner && opened.id === id ? opened.stub : null
}
