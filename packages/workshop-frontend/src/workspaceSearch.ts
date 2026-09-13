/** Chat and workpiece IDs both begin at zero. Invalid URL values never select a capability. */
export function parseWorkspaceId(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined
  if (typeof value === 'string' && value.trim() === '') return undefined
  const id = Number(value)
  return Number.isSafeInteger(id) && id >= 0 ? id : undefined
}
