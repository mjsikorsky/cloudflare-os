import { RpcTarget } from 'capnweb'

export type DeviceStateResult =
  | { status: 'available'; value: Record<string, unknown> }
  | { status: 'unavailable' | 'failed'; reason: string }

export interface DeviceStateScope { userId: string; gadgetId: number }
const MAX_BYTES = 32 * 1024
const forbidden = new Set(['__proto__', 'prototype', 'constructor'])

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function valid(value: unknown, depth = 0): boolean {
  if (depth > 12) return false
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(item => valid(item, depth + 1))
  if (!object(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
  return Object.entries(value).every(([key, item]) => !forbidden.has(key) && valid(item, depth + 1))
}

/** The iframe receives only this gadget's state, never the parent's storage API or key. */
export class GadgetDeviceState extends RpcTarget {
  #key: string | null
  #storage: Pick<Storage, 'getItem' | 'setItem'>
  #current: () => boolean
  constructor(scope: DeviceStateScope | undefined, storage: Pick<Storage, 'getItem' | 'setItem'>, current: () => boolean) {
    super()
    this.#storage = storage
    this.#current = current
    this.#key = scope && scope.userId && Number.isSafeInteger(scope.gadgetId) && scope.gadgetId >= 0
      ? `gadget-device-state:v1:${encodeURIComponent(scope.userId)}:${scope.gadgetId}` : null
  }
  load(): DeviceStateResult {
    if (!this.#current()) return { status: 'unavailable', reason: 'This gadget session has ended.' }
    if (!this.#key) return { status: 'unavailable', reason: 'The authenticated device preference scope is not available.' }
    try {
      const raw = this.#storage.getItem(this.#key)
      if (raw === null) return { status: 'available', value: {} }
      if (new TextEncoder().encode(raw).length > MAX_BYTES) throw Error('size')
      const value: unknown = JSON.parse(raw)
      if (!object(value) || !valid(value)) throw Error('shape')
      return { status: 'available', value }
    } catch { return { status: 'failed', reason: 'Device preferences could not be read from this browser.' } }
  }
  save(patch: Record<string, unknown>): DeviceStateResult {
    if (!object(patch) || !valid(patch)) return { status: 'failed', reason: 'Device preferences must contain bounded JSON values.' }
    const previous = this.load()
    if (previous.status !== 'available') return previous
    const value = { ...previous.value, ...patch }
    const encoded = JSON.stringify(value)
    if (new TextEncoder().encode(encoded).length > MAX_BYTES) return { status: 'failed', reason: 'Device preferences exceed the browser state limit.' }
    try { this.#storage.setItem(this.#key!, encoded); return { status: 'available', value } }
    catch { return { status: 'failed', reason: 'Device preferences could not be saved in this browser.' } }
  }
}
