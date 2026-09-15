import { useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { PublicApi, ServerConfig } from '@gadgets/workshop-shared/api'
import { cacheBustSiteLogoUrl } from './siteLogoUtils'

/** Deployment configuration belongs to the RPC connection that supplied it, including reconnects:
 * `config` is null until the current connection has answered. `lastKnown` is the most recent
 * configuration any connection supplied, so what the page shows (site name, logo, accent) can
 * stay put while a replacement connection is still proving itself; it must never drive
 * authentication, which follows `config` alone. */
export function useServerConfigConnection(owner: RpcStub<PublicApi>) {
  const [result, setResult] = useState<{ owner: RpcStub<PublicApi>; config: ServerConfig | null; error: boolean } | null>(null)
  const [lastKnown, setLastKnown] = useState<ServerConfig | null>(null)
  useEffect(() => {
    let cancelled = false
    owner.getServerConfig().then(config => {
      if (cancelled) return
      const current = config.siteLogo ? { ...config, siteLogo: { url: cacheBustSiteLogoUrl(config.siteLogo.url) } } : config
      setResult({ owner, error: false, config: current })
      setLastKnown(current)
    }).catch(() => { if (!cancelled) setResult({ owner, config: null, error: true }) })
    return () => { cancelled = true }
  }, [owner])
  const current = result?.owner === owner ? result : { config: null, error: false }
  return { ...current, lastKnown }
}
