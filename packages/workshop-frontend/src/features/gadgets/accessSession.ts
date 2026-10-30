import { RpcTarget } from 'capnweb'

/** Parent-owned admission status; never conveys a human identity, role or access key. */
export class GadgetAccessSession extends RpcTarget {
  #read: () => Promise<'workspace' | 'key'>
  #current: () => boolean
  constructor(read: () => Promise<'workspace' | 'key'>, current: () => boolean) { super(); this.#read = read; this.#current = current }
  async status(): Promise<{ status: 'available'; value: { mode: 'workspace' | 'key' } } | { status: 'unavailable'; reason: string }> {
    if (!this.#current()) return { status: 'unavailable', reason: 'This gadget session has ended.' }
    try {
      const mode = await this.#read()
      if (!this.#current()) return { status: 'unavailable', reason: 'This gadget session has ended.' }
      return { status: 'available', value: { mode } }
    } catch { return { status: 'unavailable', reason: 'This gadget session is no longer admitted.' } }
  }
}
