// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { AdminApi, AdminVendorPage } from '@gadgets/workshop-shared/api'
import { VendorAdminPanel } from './VendorAdminPanel'

const toasts = vi.hoisted(() => [] as { title: string; variant?: string }[])
vi.mock('@cloudflare/kumo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cloudflare/kumo')>()),
  useKumoToastManager: () => ({ add: (toast: { title: string; variant?: string }) => { toasts.push(toast) } }),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PAGE: AdminVendorPage = {
  vendorId: 'firms',
  title: 'Firms',
  view: {
    sections: [
      {
        id: 'firms',
        title: 'Firms',
        description: 'Each firm and its feeds.',
        columns: ['Firm', 'Direct Connect tenant'],
        rows: [{
          id: 'acme',
          cells: ['Acme Wealth', 'acme'],
          actions: [
            { action: 'issue-key', label: 'Issue key', input: { firm: 'acme' }, fields: [{ key: 'label', label: 'Key label', kind: 'text', required: true }] },
            { action: 'remove', label: 'Remove', input: { firm: 'acme' }, confirm: 'Remove Acme?', destructive: true },
          ],
        }],
        forms: [{
          action: 'add-firm',
          title: 'Add a firm',
          submitLabel: 'Add firm',
          fields: [
            { key: 'name', label: 'Firm name', kind: 'text', required: true },
            { key: 'plan', label: 'Plan', kind: 'select', options: [{ value: 'core', label: 'Core' }, { value: 'pro', label: 'Pro' }] },
          ],
        }],
      },
      { id: 'keys', title: 'Keys', columns: ['Key'], rows: [], emptyText: 'No keys issued yet.' },
    ],
  },
}

let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  toasts.length = 0
  vi.restoreAllMocks()
})

async function render(page: AdminVendorPage, run: AdminApi['runVendorAdminAction']) {
  const calls: [string, string, Record<string, string>][] = []
  const onChanged = vi.fn<() => Promise<void>>(async () => {})
  const admin = {
    runVendorAdminAction: async (vendorId: string, action: string, input: Record<string, string>) => {
      calls.push([vendorId, action, input])
      return run(vendorId, action, input)
    },
  } as unknown as RpcStub<AdminApi>
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(VendorAdminPanel, { admin, page, onChanged })))
  return { calls, onChanged }
}

const button = (label: string) => {
  const found = [...document.querySelectorAll('button')].find(b => b.textContent === label)
  if (!found) throw new Error(`No button "${label}"`)
  return found
}
const type = async (labelText: string, value: string) => {
  const label = [...document.querySelectorAll('label')].find(l => l.textContent?.startsWith(labelText))
  const input = label?.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null
  if (!input) throw new Error(`No field "${labelText}"`)
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
const click = async (el: HTMLElement) => { await act(async () => { el.click() }) }

describe('VendorAdminPanel', () => {
  it('renders each section as a table, or its empty text', async () => {
    await render(PAGE, async () => ({ message: 'ok' }))
    expect([...document.querySelectorAll('th')].map(th => th.textContent)).toEqual(['Firm', 'Direct Connect tenant', 'Actions'])
    expect([...document.querySelectorAll('td')].slice(0, 2).map(td => td.textContent)).toEqual(['Acme Wealth', 'acme'])
    expect(document.body.textContent).toContain('Each firm and its feeds.')
    expect(document.body.textContent).toContain('No keys issued yet.')
  })

  it('submits a form with its values once the required ones are filled, and refreshes', async () => {
    const { calls, onChanged } = await render(PAGE, async () => ({ message: 'Added Acme.' }))
    expect(button('Add firm').disabled).toBe(true)
    await type('Firm name', 'Acme Wealth')
    await type('Plan', 'pro')
    await click(button('Add firm'))
    expect(calls).toEqual([['firms', 'add-firm', { name: 'Acme Wealth', plan: 'pro' }]])
    expect(toasts).toEqual([{ title: 'Added Acme.' }])
    expect(onChanged).toHaveBeenCalledOnce()
  })

  it('asks a row action for its fields, sends them with the bound input, and shows a returned secret once', async () => {
    const { calls } = await render(PAGE, async () => ({ message: 'Issued.', secret: { label: 'Direct Connect key for Acme', value: 'dct_read_abc' } }))
    await click(button('Issue key'))
    await type('Key label', 'ledger')
    await click(button('Issue key'))
    expect(calls).toEqual([['firms', 'issue-key', { label: 'ledger', firm: 'acme' }]])
    expect(document.querySelector('[data-testid="vendor-admin-secret"]')?.textContent).toBe('dct_read_abc')
    await click(button('Done'))
    expect(document.querySelector('[data-testid="vendor-admin-secret"]')).toBeNull()
    expect(document.body.textContent).not.toContain('dct_read_abc')
  })

  it('runs a destructive action only after confirmation, and reports a refusal as an error', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { calls } = await render(PAGE, async () => { throw new Error('Acme still has keys.') })
    confirm.mockReturnValueOnce(false)
    await click(button('Remove'))
    expect(calls).toEqual([])
    confirm.mockReturnValueOnce(true)
    await click(button('Remove'))
    expect(calls).toEqual([['firms', 'remove', { firm: 'acme' }]])
    expect(toasts).toEqual([{ title: 'Acme still has keys.', variant: 'error' }])
  })

  it('says so when a vendor could not produce its page', async () => {
    await render({ vendorId: 'firms', title: 'Firms', error: 'brick unreachable' }, async () => ({ message: '' }))
    expect(document.body.textContent).toContain('Firms could not load its admin page: brick unreachable')
  })
})
