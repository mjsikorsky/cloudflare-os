/** UI mount point; Vite defaults BASE_URL to "/" for standalone deployments. */
export function basePath(base = import.meta.env.BASE_URL): string {
  if (!base.startsWith('/') || base.startsWith('//') || /[\\?#]/.test(base)) {
    throw new Error('The Workshop base URL must be an absolute path on this origin.')
  }
  return base.replace(/\/+$/, '')
}

/** Browser URL for a native route, including search/hash, under this deployment's mount. */
export function workshopPath(path: string, base = import.meta.env.BASE_URL): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('Expected a native Workshop route.')
  }
  return basePath(base) + path
}

/** External authentication may only return people to a sign-out route on this origin. */
export function externalLogoutUrl(value: string, origin: string): string {
  const url = new URL(value, origin)
  if (url.origin !== origin || url.username || url.password) {
    throw new Error('External sign-out must use this origin.')
  }
  return url.href
}
