// @vitest-environment jsdom
import React from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { GadgetClient, Overseer } from '@gadgets/workshop-shared/api'
import { useGadgetClient } from './useGadgetClient'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('selected workpiece capability ownership', () => {
  it('keeps the previous child across a connection swap, and never renders a previous workpiece', async () => {
    const firstDispose = vi.fn<() => void>(), secondDispose = vi.fn<() => void>(), thirdDispose = vi.fn<() => void>()
    const first = { [Symbol.dispose]: firstDispose } as unknown as RpcStub<GadgetClient>
    const second = { [Symbol.dispose]: secondDispose } as unknown as RpcStub<GadgetClient>
    const third = { [Symbol.dispose]: thirdDispose } as unknown as RpcStub<GadgetClient>
    const oldOwner = { getGadget: vi.fn<(id: number) => RpcStub<GadgetClient>>(() => first) } as unknown as RpcStub<Overseer>
    const newOwner = { getGadget: vi.fn<(id: number) => RpcStub<GadgetClient>>((id) => id === 0 ? second : third) } as unknown as RpcStub<Overseer>
    const rendered: Array<{ owner: RpcStub<Overseer> | null; id: number | null; child: RpcStub<GadgetClient> | null }> = []
    function View({ owner, id }: { owner: RpcStub<Overseer> | null; id: number | null }) {
      const child = useGadgetClient(owner, id)
      rendered.push({ owner, id, child })
      return null
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await React.act(async () => root.render(<View owner={oldOwner} id={0} />))
      expect(rendered.at(-1)?.child).toBe(first)

      // A reconnect replaces the connection for the same workpiece: the previous child stays
      // rendered through the effect gap (so its consumers stay mounted and swap in place), the
      // replacement takes over once opened, and the previous child is disposed exactly once.
      await React.act(async () => root.render(<View owner={newOwner} id={0} />))
      const swapped = rendered.filter(value => value.owner === newOwner)
      expect(swapped.length).toBeGreaterThan(0)
      expect(swapped.every(value => value.child === first || value.child === second)).toBe(true)
      expect(swapped.some(value => value.child === first)).toBe(true)
      expect(rendered.at(-1)?.child).toBe(second)
      expect(firstDispose).toHaveBeenCalledTimes(1)
      expect(secondDispose).not.toHaveBeenCalled()

      // A different workpiece is never served the previous workpiece's child.
      await React.act(async () => root.render(<View owner={newOwner} id={1} />))
      expect(rendered.filter(value => value.id === 1).every(value => value.child === null || value.child === third)).toBe(true)
      expect(rendered.at(-1)?.child).toBe(third)
      expect(secondDispose).toHaveBeenCalledTimes(1)

      // No connection at all yields no child, immediately.
      await React.act(async () => root.render(<View owner={null} id={null} />))
      expect(rendered.filter(value => value.owner === null).every(value => value.child === null)).toBe(true)
      expect(thirdDispose).toHaveBeenCalledTimes(1)
    } finally { await React.act(async () => root.unmount()); container.remove() }
  })
})
