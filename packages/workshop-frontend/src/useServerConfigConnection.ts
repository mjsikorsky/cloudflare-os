import { useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { PublicApi, ServerConfig } from '@gadgets/workshop-shared/api'
import { cacheBustSiteLogoUrl } from './siteLogoUtils'

/** Deployment configuration belongs to the RPC connection that supplied it, including reconnects. */
export function useServerConfigConnection(owner: RpcStub<PublicApi>) {
  const [result, setResult] = useState<{ owner: RpcStub<PublicApi>; config: ServerConfig | null; error: boolean } | null>(null)
  useEffect(() => {
    let cancelled = false
    owner.getServerConfig().then(config => {
      if (!cancelled) setResult({ owner, error: false, config: config.siteLogo ? {
        ...config, siteLogo: { url: cacheBustSiteLogoUrl(config.siteLogo.url) },
      } : config })
    }).catch(() => { if (!cancelled) setResult({ owner, config: null, error: true }) })
    return () => { cancelled = true }
  }, [owner])
  return result?.owner === owner ? result : { config: null, error: false }
}
