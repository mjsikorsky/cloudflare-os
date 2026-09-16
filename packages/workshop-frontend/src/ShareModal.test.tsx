// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type {
  AiChatAuthorInfo,
  AuthenticatedApi,
  CollaboratorRole,
  GadgetMetadata,
  ObserverBindingNeed,
  Overseer,
  ServerConfig,
  ShareLinkInfo,
} from '@gadgets/workshop-shared/api'

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT
testGlobal.IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => {
  if (previousActEnvironment === undefined) delete testGlobal.IS_REACT_ACT_ENVIRONMENT
  else testGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

vi.mock('@cloudflare/kumo', () => {
  const Dialog = Object.assign(
    ({ children }: { children: ReactNode }) => <div>{children}</div>,
    {
      Root: ({ children }: { children: ReactNode }) => <>{children}</>,
      Title: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
      Description: ({ children }: { children: ReactNode }) => <p>{children}</p>,
      Close: ({ render }: { render: (props: object) => ReactElement }) =>
        render({ 'aria-label': 'Close' }),
    },
  )
  const DropdownMenu = Object.assign(
    ({ children }: { children: ReactNode }) => <div>{children}</div>,
    {
      Trigger: ({ render }: { render: ReactElement }) => render,
      Content: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      Item: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
        <button type="button" data-testid="role-option" onClick={onClick}>{children}</button>
      ),
    },
  )
  return {
    Checkbox: ({ label }: { label: ReactNode }) => <label>{label}</label>,
    Dialog,
    DropdownMenu,
    useKumoToastManager: () => ({ add: vi.fn<(toast: unknown) => void>() }),
  }
})

vi.mock('./components/WorkshopControls', () => ({
  WorkshopButton: ({ children, ...props }: ComponentProps<'button'>) => (
    <button type="button" {...props}>{children}</button>
  ),
  WorkshopIconButton: ({ children, ...props }: ComponentProps<'button'>) => (
    <button type="button" {...props}>{children}</button>
  ),
}))

vi.mock('./components/PersonAvatar', () => ({
  PersonAvatar: () => <span data-testid="avatar" />,
}))

const copyToClipboard = vi.fn<(text: string) => Promise<boolean>>(async () => true)
vi.mock('./clipboard', () => ({ copyToClipboard: (text: string) => copyToClipboard(text) }))

import ShareModal from './ShareModal'
import { ServerConfigContext } from './ServerConfigContext'

const METADATA = { id: 'trip-planner', title: 'Trip planner' } as GadgetMetadata
const WORKSPACE_URL = `${window.location.origin}/workspace/trip-planner`

const CURRENT_USER: AiChatAuthorInfo = { type: 'user', id: 'dan@cloudflare.com', name: 'Dan' }

const DOC_REQUIREMENT: ObserverBindingNeed = {
  gatekeeperId: 7,
  vendorId: 'google',
  resourceTitle: 'Q3 planning',
  resourceUrl: 'https://docs.google.com/document/d/quarterly',
}

const CRM_REQUIREMENT: ObserverBindingNeed = {
  gatekeeperId: 8,
  vendorId: 'salesforce',
  resourceTitle: 'Pipeline dashboard',
}

const SHARE_LINK: ShareLinkInfo = {
  linkId: 'link-1',
  note: 'Team link',
  created: new Date('2026-08-01T00:00:00Z'),
  createdBy: CURRENT_USER,
  role: 'use',
}

type OverseerOverrides = {
  requirements?: Partial<Record<CollaboratorRole, ObserverBindingNeed[]>>
  listObserverRequirements?: (role: CollaboratorRole) => Promise<ObserverBindingNeed[]>
  shareLinks?: ShareLinkInfo[]
  updateShareLink?: (linkId: string, note?: string) => Promise<void>
}

function fakeOverseer(overrides: OverseerOverrides = {}): RpcStub<Overseer> {
  const requirements = overrides.requirements ?? { use: [], build: [] }
  return {
    listCollaborators: async () => [],
    listShareLinks: async () => overrides.shareLinks ?? [],
    listObserverRequirements:
      overrides.listObserverRequirements ??
      (async (role: CollaboratorRole) => requirements[role] ?? []),
    addCollaborator: async () => ({
      profile: { type: 'user', id: 'ada@cloudflare.com', name: 'Ada' },
      role: 'use',
      addedBy: [],
    }),
    createShareLink: async () => ({ key: 'secret', linkId: 'link-1' }),
    updateShareLink: overrides.updateShareLink ?? (async () => {}),
  } as unknown as RpcStub<Overseer>
}

const fakeAuthenticatedApi = {} as RpcStub<AuthenticatedApi>

function click(element: Element) {
  return act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function button(rendered: HTMLElement, label: string): HTMLButtonElement {
  const found = [...rendered.querySelectorAll('button')].find(candidate =>
    candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label)
  if (!found) throw new Error(`No button labelled “${label}”`)
  return found
}

function roleOption(rendered: HTMLElement, label: string): HTMLButtonElement {
  const found = [...rendered.querySelectorAll<HTMLButtonElement>('[data-testid="role-option"]')]
    .find(candidate => candidate.textContent?.startsWith(label))
  if (!found) throw new Error(`No role option for “${label}”`)
  return found
}

function verificationSection(rendered: HTMLElement, headingId: string): HTMLElement {
  const section = rendered.querySelector(`#${headingId}`)?.closest('section')
  if (!section) throw new Error(`No verification section with heading “${headingId}”`)
  return section
}

async function invite(rendered: HTMLElement, username: string) {
  const input = rendered.querySelector<HTMLInputElement>('input[aria-label="Username or email"]')!
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setValue.call(input, username)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click(button(rendered, 'Invite'))
}

describe('ShareModal', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  beforeEach(() => {
    copyToClipboard.mockClear()
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = undefined
    container = undefined
  })

  async function render(overseer: RpcStub<Overseer>, serverConfig: ServerConfig | null = null) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <ServerConfigContext.Provider value={serverConfig}>
          <ShareModal
            open
            onClose={() => {}}
            overseer={overseer}
            metadata={METADATA}
            currentUser={CURRENT_USER}
            authenticatedApi={fakeAuthenticatedApi}
          />
        </ServerConfigContext.Provider>,
      )
    })
    // Let the load effects settle.
    await act(async () => { await Promise.resolve() })
    return container
  }

  describe('guest links (host-owned)', () => {
    const host = { api: '/legion/api/guest-links', page: '/guest-links' }
    const config = { externalAuthentication: { logoutUrl: '/sign-out', guestLinks: host } } as unknown as ServerConfig
    const originalFetch = globalThis.fetch
    let calls: Array<{ url: string; init?: RequestInit }>
    let links: Array<{ linkId: string; title: string; url: string; createdAt: number; expiresAt: number | null; revokedAt: number | null }>
    beforeEach(() => {
      calls = []
      links = []
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        calls.push({ url, init })
        const path = new URL(url).pathname
        if (init?.method === 'POST' && path === host.api) {
          const body = JSON.parse(String(init.body))
          if (body.gadgetId !== 'trip-planner') return Response.json({ error: "You don't have access to this workspace." }, { status: 409 })
          const link = { linkId: 'a'.repeat(32), title: body.title || 'Guest link', url: `${window.location.origin}/open/${'a'.repeat(32)}`, createdAt: 1, expiresAt: body.until === 'stop' ? null : Date.now() + 3_600_000, revokedAt: null }
          links = [link, ...links]
          return Response.json({ linkId: link.linkId, url: link.url, title: link.title, expiresAt: link.expiresAt })
        }
        if (init?.method === 'POST' && path === `${host.api}/${'a'.repeat(32)}/stop`) {
          links = links.map(l => l.linkId === 'a'.repeat(32) ? { ...l, revokedAt: 2 } : l)
          return Response.json({ linkId: 'a'.repeat(32), revokedAt: 2 })
        }
        if (!init?.method && path === host.api) return Response.json({ links })
        return Response.json({ error: 'Not found.' }, { status: 404 })
      }) as typeof fetch
    })
    afterEach(() => { globalThis.fetch = originalFetch })

    it('shows nothing about guests when the host offers no guest links', async () => {
      const rendered = await render(fakeOverseer())
      expect(rendered.textContent).not.toContain('Guest link')
      expect(calls).toEqual([])
    })

    it('mints, lists, copies and stops a guest link inside the dialog, through the host API as the person', async () => {
      const rendered = await render(fakeOverseer(), config)
      expect(calls[0]?.url).toBe(`${window.location.origin}${host.api}?gadget=trip-planner`)
      expect(calls[0]?.init?.credentials).toBe('same-origin')
      expect(rendered.textContent).not.toContain('Guest links')

      await click(button(rendered, 'Guest link…'))
      const name = rendered.querySelector<HTMLInputElement>('input[aria-label="Guest link name (optional)"]')!
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      await act(async () => { setValue.call(name, 'Board night'); name.dispatchEvent(new Event('input', { bubbles: true })) })
      await click(button(rendered, 'Create guest link'))
      await act(async () => { await Promise.resolve() })

      const create = calls.find(c => c.init?.method === 'POST')!
      expect(create.url).toBe(`${window.location.origin}${host.api}`)
      expect(JSON.parse(String(create.init?.body))).toEqual({ gadgetId: 'trip-planner', title: 'Board night', until: 'stop' })
      expect(rendered.textContent).toContain('Guest link ready')
      expect(rendered.textContent).toContain(`/open/${'a'.repeat(32)}`)
      expect(rendered.textContent).toContain('Guest links')
      expect(rendered.textContent).toContain('Until you stop it')
      expect(rendered.querySelector('a[href*="/guest-links"]')?.textContent).toBe('All your guest links')

      await click(button(rendered, 'Copy'))
      expect(copyToClipboard).toHaveBeenCalledWith(`${window.location.origin}/open/${'a'.repeat(32)}`)

      await click(button(rendered, 'Stop Board night'))
      await click(button(rendered, 'Stop'))
      await act(async () => { await Promise.resolve() })
      expect(calls.some(c => c.url.endsWith(`/${'a'.repeat(32)}/stop`) && c.init?.method === 'POST')).toBe(true)
      expect(rendered.textContent).not.toContain('Guest links')
      expect(rendered.textContent).not.toContain('Guest link ready')
    })
  })

  it('reveals the workspace link to send after a direct invite', async () => {
    const rendered = await render(fakeOverseer())
    expect(rendered.textContent).not.toContain(WORKSPACE_URL)

    await invite(rendered, 'ada')

    expect(rendered.textContent).toContain('Added Ada')
    expect(rendered.textContent).toContain(WORKSPACE_URL)
  })

  it('copies the plain workspace link, never a share-link secret', async () => {
    const rendered = await render(fakeOverseer())
    await invite(rendered, 'ada')

    await click(button(rendered, 'Copy link'))

    expect(copyToClipboard).toHaveBeenCalledWith(WORKSPACE_URL)
    expect(rendered.textContent).toContain('Link copied')
  })

  it('names the connections a recipient must verify for the selected role', async () => {
    const rendered = await render(fakeOverseer({
      requirements: { use: [DOC_REQUIREMENT], build: [DOC_REQUIREMENT, CRM_REQUIREMENT] },
    }))

    // The invite composer defaults to "App only".
    expect(rendered.textContent).toContain('Q3 planning')
    expect(rendered.textContent).not.toContain('Pipeline dashboard')

    await click(roleOption(rendered, 'Workspace'))

    expect(rendered.textContent).toContain('Pipeline dashboard')
  })

  it('keeps invite and share-link requirements tied to their own role pickers', async () => {
    const rendered = await render(fakeOverseer({
      requirements: { use: [DOC_REQUIREMENT], build: [DOC_REQUIREMENT, CRM_REQUIREMENT] },
    }))

    await click(button(rendered, 'Create a share link'))
    expect(rendered.querySelector('#recipient-verification-heading')).not.toBeNull()
    expect(rendered.querySelector('#invite-verification-heading')).toBeNull()
    expect(rendered.querySelector('#link-verification-heading')).toBeNull()

    const buildOptions = [...rendered.querySelectorAll<HTMLButtonElement>('[data-testid="role-option"]')]
      .filter(option => option.textContent?.startsWith('Workspace'))
    expect(buildOptions).toHaveLength(2)
    await click(buildOptions[1])

    expect(verificationSection(rendered, 'invite-verification-heading').textContent)
      .not.toContain('Pipeline dashboard')
    expect(verificationSection(rendered, 'link-verification-heading').textContent)
      .toContain('Pipeline dashboard')

    await click(button(rendered, 'Create link'))
    expect(verificationSection(rendered, 'link-verification-heading').textContent)
      .toContain('Pipeline dashboard')
  })

  it('hides verification messaging when recipients have nothing to verify', async () => {
    const rendered = await render(fakeOverseer())

    expect(rendered.querySelector('#recipient-verification-heading')).toBeNull()
    expect(rendered.textContent).not.toContain('verify any connections')
  })

  it('degrades quietly when the requirements lookup fails', async () => {
    const rendered = await render(fakeOverseer({
      listObserverRequirements: async () => { throw new Error('offline') },
    }))

    expect(rendered.textContent).toContain('Couldn’t check')
    // The rest of the modal still works.
    expect(rendered.textContent).toContain('People with access')
  })

  it('refreshes requirements when the modal regains focus', async () => {
    const listObserverRequirements = vi.fn<
      (role: CollaboratorRole) => Promise<ObserverBindingNeed[]>
    >(async () => [])
    await render(fakeOverseer({ listObserverRequirements }))
    expect(listObserverRequirements).toHaveBeenCalledTimes(2)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })

    expect(listObserverRequirements).toHaveBeenCalledTimes(4)
  })

  it('does not rename a share link when its name did not change', async () => {
    const updateShareLink = vi.fn<(linkId: string, note?: string) => Promise<void>>(async () => {})
    const rendered = await render(fakeOverseer({ shareLinks: [SHARE_LINK], updateShareLink }))

    await click(button(rendered, 'Rename Team link'))
    expect(rendered.querySelector<HTMLInputElement>('input[aria-label="Share link name"]')?.value)
      .toBe('Team link')
    await click(button(rendered, 'Save'))

    expect(updateShareLink).not.toHaveBeenCalled()
    expect(rendered.querySelector('input[aria-label="Share link name"]')).toBeNull()
  })
})
