import { expect, it } from 'vitest'
import { GadgetAccessSession } from './accessSession'
it('reports OS admission refusal without exposing keys or invented identity', async () => {
  let allowed = true
  const resource = new GadgetAccessSession(async () => { if (!allowed) throw Error('denied'); return 'key' }, () => true)
  expect(await resource.status()).toEqual({ status: 'available', value: { mode: 'key' } })
  expect(Object.keys(resource)).toEqual([])
  allowed = false
  expect(await resource.status()).toEqual({ status: 'unavailable', reason: 'This gadget session is no longer admitted.' })
})
it('refuses stale asynchronous admission results after the parent session ends', async () => {
  let finish!: (mode: 'key') => void, current = true
  const resource = new GadgetAccessSession(() => new Promise(resolve => { finish = resolve }), () => current)
  const pending = resource.status(); current = false; finish('key')
  expect((await pending).status).toBe('unavailable')
})
