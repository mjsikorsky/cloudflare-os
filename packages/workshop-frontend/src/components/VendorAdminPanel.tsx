// One gatekeeper vendor's /admin page (VendorDescription.providesAdmin): its sections rendered as
// data -- a table per section, row buttons, and forms -- with every action run through
// AdminApi.runVendorAdminAction. A secret an action returns (a newly issued key) is shown once,
// held only in this component's state, and gone when dismissed.

import { useState } from 'react'
import { Button, Input, useKumoToastManager } from '@cloudflare/kumo'
import type { RpcStub } from 'capnweb'
import type { AdminApi, AdminVendorPage } from '@gadgets/workshop-shared/api'
import type {
  VendorAdminButton,
  VendorAdminField,
  VendorAdminForm,
  VendorAdminSection,
} from '@gadgets/workshop-shared/gatekeeper'

const CARD = 'bg-kumo-elevated border border-kumo-line rounded-xl p-6'

export function VendorAdminPanel({ admin, page, onChanged }: {
  admin: RpcStub<AdminApi>
  page: AdminVendorPage
  onChanged: () => Promise<void>
}) {
  const toasts = useKumoToastManager()
  const [busy, setBusy] = useState<string | null>(null)
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null)

  const run = async (key: string, action: string, input: Record<string, string>): Promise<boolean> => {
    setBusy(key)
    try {
      const result = await admin.runVendorAdminAction(page.vendorId, action, input)
      toasts.add({ title: result.message })
      if (result.secret) setSecret({ label: result.secret.label, value: result.secret.value })
      await onChanged()
      return true
    } catch (err) {
      toasts.add({ title: err instanceof Error ? err.message : String(err), variant: 'error' })
      return false
    } finally {
      setBusy(null)
    }
  }

  if (page.error !== undefined || !page.view) {
    return (
      <div className={CARD}>
        <p className="text-sm text-kumo-danger">{page.title} could not load its admin page: {page.error ?? 'no page returned.'}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {secret && <SecretOnce secret={secret} onDismiss={() => setSecret(null)} />}
      {page.view.sections.map(section => (
        <SectionCard key={section.id} section={section} busy={busy} run={run} />
      ))}
    </div>
  )
}

/** A value an action returned, shown once: copy it now, it is not shown again. */
function SecretOnce({ secret, onDismiss }: { secret: { label: string; value: string }; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div role="alert" className="rounded-xl border border-kumo-warning bg-kumo-warning/10 p-4">
      <p className="text-sm font-medium text-kumo-default">{secret.label}</p>
      <p className="mt-1 text-xs text-kumo-subtle">Copy it now. It is shown once and is not stored here.</p>
      <code data-testid="vendor-admin-secret" className="mt-2 block break-all rounded-md bg-kumo-base p-2 font-mono text-xs text-kumo-default">{secret.value}</code>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => { void navigator.clipboard?.writeText(secret.value).then(() => setCopied(true), () => {}) }}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>Done</Button>
      </div>
    </div>
  )
}

function SectionCard({ section, busy, run }: {
  section: VendorAdminSection
  busy: string | null
  run: (key: string, action: string, input: Record<string, string>) => Promise<boolean>
}) {
  return (
    <section className={CARD} aria-labelledby={`vendor-admin-${section.id}`}>
      <h3 id={`vendor-admin-${section.id}`} className="text-[15px] font-semibold text-kumo-default">{section.title}</h3>
      {section.description && <p className="mt-1 text-sm text-kumo-subtle">{section.description}</p>}
      {section.rows.length === 0 ? (
        <p className="mt-4 text-sm text-kumo-inactive">{section.emptyText ?? 'Nothing here yet.'}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-kumo-inactive">
                {section.columns.map(column => <th key={column} scope="col" className="pb-2 pr-4 font-medium">{column}</th>)}
                <th scope="col" className="pb-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map(row => (
                <tr key={row.id} className="border-t border-kumo-line align-top">
                  {row.cells.map((cell, index) => <td key={index} className="py-2 pr-4 text-kumo-default">{cell}</td>)}
                  <td className="py-2">
                    <div className="flex flex-wrap justify-end gap-2">
                      {(row.actions ?? []).map(button => (
                        <RowAction key={button.action + JSON.stringify(button.input)} button={button}
                          busyKey={`${section.id}\u0000${row.id}\u0000${button.action}`} busy={busy} run={run} />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(section.forms ?? []).map(form => (
        <AdminForm key={form.action} form={form} busyKey={`${section.id}\u0000form\u0000${form.action}`} busy={busy} run={run} />
      ))}
    </section>
  )
}

/** A row button: asks for its fields (if any) and a confirmation (if any), then runs. */
function RowAction({ button, busyKey, busy, run }: {
  button: VendorAdminButton
  busyKey: string
  busy: string | null
  run: (key: string, action: string, input: Record<string, string>) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const fields = button.fields ?? []
  const go = async () => {
    if (button.confirm && !window.confirm(button.confirm)) return
    if (await run(busyKey, button.action, { ...values, ...button.input })) {
      setOpen(false)
      setValues({})
    }
  }
  if (fields.length > 0 && open) {
    return (
      <div className="flex flex-wrap items-end gap-2">
        {fields.map(field => (
          <FieldInput key={field.key} field={field} value={values[field.key] ?? ''} onChange={value => setValues(v => ({ ...v, [field.key]: value }))} />
        ))}
        <Button size="sm" disabled={busy !== null || !requiredFilled(fields, values)} onClick={() => void go()}>{button.label}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    )
  }
  return (
    <Button size="sm" variant={button.destructive ? 'destructive' : 'secondary'} disabled={busy !== null}
      onClick={() => (fields.length > 0 ? setOpen(true) : void go())}>
      {busy === busyKey ? 'Working…' : button.label}
    </Button>
  )
}

function AdminForm({ form, busyKey, busy, run }: {
  form: VendorAdminForm
  busyKey: string
  busy: string | null
  run: (key: string, action: string, input: Record<string, string>) => Promise<boolean>
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  return (
    <form
      className="mt-5 border-t border-kumo-line pt-4"
      onSubmit={event => {
        event.preventDefault()
        void run(busyKey, form.action, values).then(ok => { if (ok) setValues({}) })
      }}
    >
      <p className="text-sm font-medium text-kumo-default">{form.title}</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {form.fields.map(field => (
          <FieldInput key={field.key} field={field} value={values[field.key] ?? ''} onChange={value => setValues(v => ({ ...v, [field.key]: value }))} />
        ))}
        <Button type="submit" size="sm" disabled={busy !== null || !requiredFilled(form.fields, values)}>
          {busy === busyKey ? 'Working…' : form.submitLabel}
        </Button>
      </div>
    </form>
  )
}

function requiredFilled(fields: VendorAdminField[], values: Record<string, string>): boolean {
  return fields.every(field => !field.required || (values[field.key] ?? '').trim() !== '')
}

function FieldInput({ field, value, onChange }: { field: VendorAdminField; value: string; onChange: (value: string) => void }) {
  const id = `vendor-admin-field-${field.key}`
  return (
    <label htmlFor={id} className="flex min-w-[180px] flex-col gap-1 text-xs text-kumo-subtle">
      {field.label}
      {field.kind === 'select' ? (
        <select id={id} value={value} onChange={event => onChange(event.target.value)}
          className="h-8 rounded-md border border-kumo-line bg-kumo-base px-2 text-sm text-kumo-default">
          <option value="">Choose…</option>
          {(field.options ?? []).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : (
        <Input id={id} size="sm" value={value} placeholder={field.placeholder} onChange={event => onChange(event.target.value)} />
      )}
      {field.help && <span className="text-[11px] text-kumo-inactive">{field.help}</span>}
    </label>
  )
}
