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

