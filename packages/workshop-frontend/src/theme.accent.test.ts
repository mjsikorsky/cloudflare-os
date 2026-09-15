// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { applyStoredAccentColor, readStoredAccentColor, writeStoredAccentColor } from './theme'

// Isolated storage; this suite tests the remembered accent, not browser storage itself.
const stored = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key), clear: () => stored.clear() })

afterEach(() => { stored.clear(); document.documentElement.removeAttribute('style') })

it('remembers a valid deployment accent for the next first paint and forgets an unset or invalid one', () => {
  expect(readStoredAccentColor()).toBeNull()
  applyStoredAccentColor()
  expect(document.documentElement.style.getPropertyValue('--color-kumo-brand')).toBe('')
  writeStoredAccentColor('#7c3aed')
  expect(readStoredAccentColor()).toBe('#7c3aed')
  applyStoredAccentColor()
  expect(document.documentElement.style.getPropertyValue('--color-kumo-brand')).toContain('#7c3aed')
  writeStoredAccentColor('')
  expect(readStoredAccentColor()).toBeNull()
  stored.set('gadgets:accent-color', 'javascript:alert(1)')
  expect(readStoredAccentColor()).toBeNull()
  applyStoredAccentColor()
  expect(document.documentElement.style.getPropertyValue('--color-kumo-brand')).toBe('')
})
