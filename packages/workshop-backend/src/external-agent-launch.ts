import type { ExternalAgentLaunch } from '@gadgets/workshop-shared/api';

/** Validate deployment configuration before exposing a native workspace action.
 * @param value Deployment JSON, or undefined when no launcher is configured.
 * @returns The safe public action; invalid configured values fail visibly.
 */
export function parseExternalAgentLaunch(value: unknown): ExternalAgentLaunch | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid external agent launcher');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || typeof input.label !== 'string' || !input.label.trim()
      || input.label.length > 120 || [...input.label].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      || typeof input.actionUrl !== 'string' || !input.actionUrl.startsWith('/')
      || input.actionUrl.startsWith('//') || input.actionUrl.includes('\\')) throw new Error('Invalid external agent launcher');
  const url = new URL(input.actionUrl, 'https://native.invalid');
  if (url.origin !== 'https://native.invalid' || url.pathname !== input.actionUrl || url.search || url.hash)
    throw new Error('External agent launcher must use an absolute same-origin path');
  return {label: input.label, actionUrl: input.actionUrl};
}
