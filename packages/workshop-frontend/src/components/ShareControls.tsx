import { DropdownMenu } from '@cloudflare/kumo'
import type { PortalContainer } from '@cloudflare/kumo'
import { CaretDown, Check, X } from '@phosphor-icons/react'

/** The Share dialog's own controls, shared by everything that lives in it: a choice menu (the
 * role picker's markup, over any option set) and the two-button inline confirmation. */

export type Choice<T extends string> = { value: T; label: string; description: string }

export function ChoiceMenu<T extends string>({
  value,
  options,
  onValueChange,
  disabled,
  ariaLabel,
  container,
}: {
  value: T
  options: ReadonlyArray<Choice<T>>
  onValueChange: (value: T) => void
  disabled?: boolean
  ariaLabel: string
  container?: PortalContainer
}) {
  const current = options.find(option => option.value === value) ?? options[0]
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger
        disabled={disabled}
        render={
          <button
            type="button"
            className="group inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[12px] leading-4 font-medium text-kumo-subtle transition-[background-color,color,transform] duration-150 ease-out hover:bg-kumo-tint hover:text-kumo-default focus-visible:bg-kumo-tint focus-visible:text-kumo-default focus-visible:outline-none active:scale-[0.97] data-[popup-open]:bg-kumo-tint data-[popup-open]:text-kumo-default disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={ariaLabel}
          >
            {current.label}
            <CaretDown size={11} weight="bold" className="text-kumo-inactive transition-transform duration-150 ease-out group-data-[popup-open]:rotate-180" />
          </button>
        }
      />
      <DropdownMenu.Content
        container={container}
        align="end"
        sideOffset={6}
        className="themed-floating-shadow-lg !z-[1100] !w-[300px] !min-w-0 rounded-2xl border border-kumo-line/70 bg-kumo-base p-1 !ring-kumo-line"
      >
        {options.map(option => (
          <DropdownMenu.Item
            key={option.value}
            onClick={() => onValueChange(option.value)}
            className="!h-auto cursor-pointer rounded-xl !px-2.5 !py-2 text-kumo-default transition-colors data-highlighted:bg-kumo-tint/70"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] leading-4 font-medium">{option.label}</span>
              <span className="mt-0.5 block text-[11px] leading-4 font-normal text-kumo-subtle">
                {option.description}
              </span>
            </span>
            <span className="ml-2 flex h-4 w-4 shrink-0 items-center justify-center">
              {value === option.value && <Check size={13} weight="bold" className="text-kumo-brand" />}
            </span>
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}

export function InlineConfirm({
  label,
  busy,
  busyLabel,
  tone = 'danger',
  onConfirm,
  onCancel,
}: {
  label: string
  busy: boolean
  busyLabel?: string
  tone?: 'danger' | 'brand'
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex items-center gap-1 share-confirm-in">
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy}
        className={`inline-flex h-7 cursor-pointer items-center rounded-lg px-2.5 text-[12px] leading-4 font-medium tracking-[-0.1px] transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] disabled:opacity-60 ${
          tone === 'danger'
            ? 'text-kumo-danger hover:bg-kumo-danger-tint'
            : 'text-kumo-brand hover:bg-kumo-tint'
        }`}
      >
        {busy ? (busyLabel ?? `${label}…`) : label}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        aria-label="Cancel"
        className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg text-kumo-inactive transition-[background-color,color,transform] duration-150 ease-out hover:bg-kumo-tint hover:text-kumo-default active:scale-[0.96] disabled:opacity-60"
      >
        <X size={14} />
      </button>
    </div>
  )
}
