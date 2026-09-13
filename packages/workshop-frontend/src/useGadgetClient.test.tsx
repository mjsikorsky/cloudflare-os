// @vitest-environment jsdom
import React from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { GadgetClient, Overseer } from '@gadgets/workshop-shared/api'
import { useGadgetClient } from './useGadgetClient'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('selected workpiece capability ownership', () => {
  it('never renders a previous connection or workpiece child during the effect gap', async () => {
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
      await React.act(async () => root.render(<View owner={newOwner} id={0} />))
      expect(rendered.filter(value => value.owner === newOwner).every(value => value.child === null || value.child === second)).toBe(true)
      expect(firstDispose).toHaveBeenCalledTimes(1)
      await React.act(async () => root.render(<View owner={newOwner} id={1} />))
      expect(rendered.filter(value => value.id === 1).every(value => value.child === null || value.child === third)).toBe(true)
      expect(secondDispose).toHaveBeenCalledTimes(1)
      await React.act(async () => root.render(<View owner={null} id={null} />))
      expect(rendered.at(-1)?.child).toBeNull()
      expect(thirdDispose).toHaveBeenCalledTimes(1)
    } finally { await React.act(async () => root.unmount()); container.remove() }
  })
})
