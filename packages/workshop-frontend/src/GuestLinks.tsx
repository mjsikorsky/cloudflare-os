import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Globe, Trash, X } from '@phosphor-icons/react'
import { useKumoToastManager } from '@cloudflare/kumo'
import type { GuestLinkInfo, GuestLinksHost } from '@gadgets/workshop-shared/api'
import { WorkshopButton, WorkshopIconButton } from './components/WorkshopControls'
import { copyToClipboard } from './clipboard'

/** Guest links: people who use a gadget live, without an account. The embedding host owns them —
 * it mints, lists and stops them as the signed-in person over its own same-origin API, which the
 * host names in ServerConfig.externalAuthentication.guestLinks. This UI only calls that API with
 * the browser's own credentials and shows what comes back; nothing here holds a key. */

export const GUEST_LINK_UNTIL: Array<[string, string]> = [
  ['3h', 'For 3 hours'], ['24h', 'For 24 hours'], ['7d', 'For 7 days'], ['stop', 'Until I stop it'],
]

function hostUrl(host: GuestLinksHost, gadgetId: string, suffix = ''): string {
  const url = new URL(host.api + suffix, window.location.origin)
  if (!suffix) url.searchParams.set('gadget', gadgetId)
  return url.href
}

async function hostCall<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { credentials: 'same-origin', ...init })
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error || 'Your workspace did not answer.')
  return body
}

export function isGuestLinkLive(link: GuestLinkInfo, now = Date.now()): boolean {
  return link.revokedAt === null && (link.expiresAt === null || link.expiresAt > now)
}

export function describeGuestLinkEnd(link: GuestLinkInfo, now = Date.now()): string {
  if (link.revokedAt !== null) return 'Stopped'
  if (link.expiresAt === null) return 'Until you stop it'
  const hours = Math.round((link.expiresAt - now) / 3_600_000)
  if (hours < 1) return 'Ends within the hour'
  if (hours < 48) return `Ends in ${hours} h`
  return `Ends in ${Math.round(hours / 24)} d`
}

export function useGuestLinks(host: GuestLinksHost | undefined, gadgetId: string) {
  const [links, setLinks] = useState<GuestLinkInfo[] | null>(null)
  const [created, setCreated] = useState<{ url: string; title: string } | null>(null)
  const [busy, setBusy] = useState<'create' | 'stop' | null>(null)
  // The toast manager's identity is not part of this hook's contract: hold the latest one.
  const toastsRef = useRef(useKumoToastManager())
  toastsRef.current = useKumoToastManager()
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const report = (message: string) => { if (alive.current) toastsRef.current.add({ title: message, variant: 'error' }) }

  const reload = useCallback(async () => {
    if (!host) return
    try {
      const { links } = await hostCall<{ links: GuestLinkInfo[] }>(hostUrl(host, gadgetId))
      if (alive.current) setLinks(links)
    } catch (err: any) {
      report(err.message || 'Could not load guest links.')
    }
  }, [host, gadgetId])

  useEffect(() => { void reload() }, [reload])

  const create = useCallback(async (title: string, until: string) => {
    if (!host || busy) return false
    setBusy('create')
    try {
      const link = await hostCall<{ url: string; title: string }>(new URL(host.api, window.location.origin).href, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gadgetId, title, until }),
      })
      if (!alive.current) return true
      setCreated({ url: link.url, title: link.title })
      await reload()
      return true
    } catch (err: any) {
      report(err.message || 'Could not create the guest link.')
      return false
    } finally { if (alive.current) setBusy(null) }
  }, [host, gadgetId, busy, reload])

  const stop = useCallback(async (linkId: string) => {
    if (!host || busy) return false
    setBusy('stop')
    try {
      await hostCall(hostUrl(host, gadgetId, `/${linkId}/stop`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (alive.current) { setCreated(current => (current && links?.find(l => l.linkId === linkId)?.url === current.url ? null : current)); await reload() }
      return true
    } catch (err: any) {
      report(err.message || 'Could not stop the guest link.')
      return false
    } finally { if (alive.current) setBusy(null) }
  }, [host, gadgetId, busy, links, reload])

  return { links, created, dismissCreated: () => setCreated(null), busy, create, stop }
}

type Composer = ReturnType<typeof useGuestLinks>

/** The entry under "Create a share link": a row that expands into name + duration + Create, and
 * shows the guest URL to send once it exists. */
export function GuestLinkComposer({ guest, disabled }: { guest: Composer; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [until, setUntil] = useState('stop')
  const [copied, setCopied] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open && !guest.created) nameRef.current?.focus({ preventScroll: true }) }, [open, guest.created])
  useEffect(() => { setCopied(false) }, [guest.created])

  const submit = async () => {
    if (disabled || guest.busy) return
    if (await guest.create(title.trim(), until)) setTitle('')
  }
  const copy = async () => {
    if (!guest.created) return
    if (await copyToClipboard(guest.created.url)) setCopied(true)
  }

  if (guest.created) {
    return (
      <div className="themed-compact-shadow mt-2 flex flex-wrap items-center gap-3 rounded-2xl border border-kumo-line/80 bg-kumo-base px-3 py-2.5 share-fade-in">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-kumo-tint text-kumo-subtle">
          {copied ? <Check size={15} weight="bold" /> : <Globe size={15} />}
        </div>
        <div className="min-w-[160px] flex-1">
          <div className="flex items-baseline gap-1.5">
            <p className="text-[13px] leading-[18px] font-medium text-kumo-default">{copied ? 'Guest link copied' : 'Guest link ready'}</p>
            <span className="text-[11px] leading-4 text-kumo-inactive">Anyone with it can use this gadget, no sign-in</span>
          </div>
          <p className="truncate font-mono text-[11px] leading-4 text-kumo-subtle">{guest.created.url}</p>
        </div>
        <WorkshopButton tone="primary" onClick={copy} className="w-[78px] gap-1.5 !rounded-xl">
          {copied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </WorkshopButton>
        <WorkshopIconButton aria-label="Dismiss created guest link" onClick={() => { guest.dismissCreated(); setOpen(false) }}>
          <X size={14} />
        </WorkshopIconButton>
      </div>
    )
  }
  if (open) {
    return (
      <div className="themed-compact-shadow mt-2 flex h-12 items-center gap-2 overflow-hidden rounded-2xl border border-kumo-line/80 bg-kumo-base p-1.5 pl-3 transition-[border-color,box-shadow] focus-within:border-kumo-fill share-fade-in">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-kumo-tint text-kumo-subtle"><Globe size={15} /></div>
        <input
          ref={nameRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') setOpen(false) }}
          placeholder="Name this guest link (optional)…"
          aria-label="Guest link name (optional)"
          maxLength={120}
          className="h-9 min-w-0 flex-1 border-0 bg-transparent p-0 text-[14px] leading-5 tracking-[-0.25px] text-kumo-default outline-none placeholder:text-kumo-inactive"
          disabled={guest.busy === 'create' || disabled}
        />
        <select
          aria-label="How long the guest link stays open"
          value={until}
          onChange={e => setUntil(e.target.value)}
          disabled={guest.busy === 'create' || disabled}
          className="h-8 shrink-0 rounded-lg border border-kumo-line bg-kumo-base px-2 text-[12px] leading-4 text-kumo-default outline-none"
        >
          {GUEST_LINK_UNTIL.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <WorkshopButton tone="primary" className="shrink-0 !rounded-xl" onClick={submit} disabled={guest.busy === 'create' || disabled}>
          {guest.busy === 'create' ? 'Creating…' : 'Create guest link'}
        </WorkshopButton>
        <WorkshopIconButton aria-label="Cancel creating guest link" onClick={() => setOpen(false)}><X size={14} /></WorkshopIconButton>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      disabled={disabled}
      className="themed-compact-shadow mt-2 flex h-12 w-full cursor-pointer items-center justify-center gap-1.5 rounded-2xl border border-kumo-line/80 bg-kumo-base px-3 text-[13px] font-medium text-kumo-subtle transition-[background-color,color,transform] duration-150 ease-out hover:bg-kumo-elevated/60 hover:text-kumo-default active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Globe size={14} /> Guest link…
    </button>
  )
}

/** The live guest links for this gadget, with copy and stop. */
export function GuestLinkList({ guest, host, disabled }: { guest: Composer; host: GuestLinksHost; disabled: boolean }) {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [stopping, setStopping] = useState<string | null>(null)
  const live = (guest.links ?? []).filter(link => isGuestLinkLive(link))
  if (live.length === 0) return null
  const copy = async (link: GuestLinkInfo) => { if (await copyToClipboard(link.url)) setCopiedId(link.linkId) }
  const confirmStop = async (linkId: string) => { if (await guest.stop(linkId)) setStopping(null) }
  return (
    <section aria-labelledby="guest-links-heading" className="mt-4">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h3 id="guest-links-heading" className="text-[12px] leading-4 font-medium tracking-[-0.15px] text-kumo-subtle">Guest links</h3>
        <a href={new URL(host.page, window.location.origin).href} target="_blank" rel="noopener" className="text-[11px] leading-4 text-kumo-inactive hover:text-kumo-default">All your guest links</a>
      </div>
      <div className="overflow-hidden rounded-2xl border border-kumo-line/80 bg-kumo-base">
        {live.map((link, index) => (
          <div key={link.linkId} className={`group ${index > 0 ? 'border-t border-kumo-line/70' : ''} transition-colors duration-150 hover:bg-kumo-elevated/50 px-3 py-2.5`}>
            <div className="flex items-center gap-3">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-kumo-tint to-kumo-elevated text-kumo-subtle ring-1 ring-inset ring-kumo-line/60"><Globe size={14} /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] leading-[17px] font-medium tracking-[-0.25px] text-kumo-default">{link.title}</p>
                <p className="truncate text-[12px] leading-[15px] tracking-[-0.15px] text-kumo-subtle">{describeGuestLinkEnd(link)} · guests use it live, no sign-in</p>
              </div>
              {stopping === link.linkId ? (
                <div className="flex items-center gap-1 share-confirm-in">
                  <button type="button" onClick={() => confirmStop(link.linkId)} disabled={guest.busy === 'stop'}
                    className="inline-flex h-7 cursor-pointer items-center rounded-lg px-2.5 text-[12px] leading-4 font-medium tracking-[-0.1px] text-kumo-danger transition-[background-color,transform] duration-150 ease-out hover:bg-kumo-danger-tint active:scale-[0.97] disabled:opacity-60">
                    {guest.busy === 'stop' ? 'Stopping…' : 'Stop'}
                  </button>
                  <button type="button" onClick={() => setStopping(null)} disabled={guest.busy === 'stop'} aria-label="Cancel"
                    className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg text-kumo-inactive transition-[background-color,color,transform] duration-150 ease-out hover:bg-kumo-tint hover:text-kumo-default active:scale-[0.96] disabled:opacity-60">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <WorkshopIconButton className="!h-7 !w-7" onClick={() => copy(link)} aria-label={`Copy ${link.title}`} disabled={disabled}>
                    {copiedId === link.linkId ? <Check size={13} weight="bold" /> : <Copy size={13} />}
                  </WorkshopIconButton>
                  <WorkshopIconButton danger className="!h-7 !w-7 opacity-35 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => setStopping(link.linkId)} aria-label={`Stop ${link.title}`} disabled={disabled || guest.busy !== null}>
                    <Trash size={13} />
                  </WorkshopIconButton>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
