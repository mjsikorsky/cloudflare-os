// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import type { ServerConfig } from '@gadgets/workshop-shared/api'
import { ServerConfigContext } from '../ServerConfigContext'
import ExternalAgentLaunch from './ExternalAgentLaunch'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let container: HTMLDivElement | undefined
afterEach(() => { act(() => root?.unmount()); container?.remove() })
function render(workspaceId: string, chatId: number | null, configured = true) {
  if (!root) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  const config = { externalAgentLaunch: configured ? { label: 'Open with your Dragon', actionUrl: '/legion/api/dsh/contribute' } : undefined } as ServerConfig
  act(() => root!.render(<ServerConfigContext.Provider value={config}>
    <ExternalAgentLaunch workspaceId={workspaceId} chatId={chatId} />
  </ServerConfigContext.Provider>))
}
it('posts the current native selection including chat zero and changes when navigation changes', () => {
  render('a'.repeat(64), 0)
  const selected = () => new FormData(container!.querySelector('form')!)
  expect([...selected()]).toEqual([['cfosWorkspaceId', 'a'.repeat(64)], ['cfosChatId', '0']])
  const form = container!.querySelector('form')!
  expect(form.getAttribute('action')).toBe('/legion/api/dsh/contribute')
  expect(form.method).toBe('post')
  expect(form.target).toBe('_blank')
  expect(form.getAttribute('rel')).toContain('noopener')
  render('b'.repeat(64), 17)
  expect([...selected()]).toEqual([['cfosWorkspaceId', 'b'.repeat(64)], ['cfosChatId', '17']])
  // No authority, revision or output data is copied into the launch intent.
  expect([...selected().keys()]).toHaveLength(2)
  render('b'.repeat(64), null)
  expect(container!.querySelector('form')).toBeNull()
  render('b'.repeat(64), 17, false)
  expect(container!.querySelector('form')).toBeNull()
})
