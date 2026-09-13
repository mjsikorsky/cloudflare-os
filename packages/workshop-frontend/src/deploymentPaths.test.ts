import { describe, expect, it } from 'vitest'
import { basePath, workshopPath } from './deploymentPaths'
import { parseWorkspaceId } from './workspaceSearch'

describe('native deployment routes', () => {
  it.each(['/', '/workshop/', '/nested/workshop/'])('keeps links and route matching inside %s', (base) => {
    const mount = basePath(base)
    const paths = ['/', '/workspaces', '/workspace/id?chat=0&w=0#share=key', '/blueprint/id', '/gatekeepers/context']
    for (const path of paths) expect(workshopPath(path, base)).toBe(mount + path)
  })
  it('rejects origin-changing mounts and links', () => {
    for (const base of ['https://other.test/', '//other.test/', '/workshop?query']) expect(() => basePath(base)).toThrow("The Workshop base URL must be an absolute path on this origin.")
    for (const path of ['https://other.test/', '//other.test/', 'workspace/id']) expect(() => workshopPath(path, '/workshop/')).toThrow('Expected a native Workshop route.')
  })
})

describe('native chat and workpiece URL selection', () => {
  it('preserves identity zero as a number or string', () => {
    expect(parseWorkspaceId('0')).toBe(0)
    expect(parseWorkspaceId(0)).toBe(0)
    expect(parseWorkspaceId('12')).toBe(12)
  })
  it.each([undefined, null, '', ' ', true, [], {}, -1, '-1', 0.5, 'NaN', Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid identity %s', (value) => {
    expect(parseWorkspaceId(value)).toBeUndefined()
  })
})
