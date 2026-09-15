import { createContext, useContext } from 'react'
import { ServerConfig, AuthVendorInfo, resolveSiteName } from '@gadgets/workshop-shared/api'

// Deployment-level configuration fetched via PublicApi.getServerConfig(). `null` while still
// loading. While a replacement connection (after a disconnect) is still answering, this carries
// the last known configuration so the page keeps its name, logo and accent instead of falling
// back to defaults for a moment.
export const ServerConfigContext = createContext<ServerConfig | null>(null)
export const ServerConfigErrorContext = createContext(false)
// The configuration supplied by the CURRENT connection only, null until it has answered.
// Authentication follows this one: an admission is proven against the connection that carries it.
export const ConnectionConfigContext = createContext<ServerConfig | null>(null)

// Returns the server config, or null while it is still loading.
export function useServerConfig(): ServerConfig | null {
  return useContext(ServerConfigContext)
}

// Returns the current connection's own config, or null until that connection has answered.
export function useConnectionConfig(): ServerConfig | null {
  return useContext(ConnectionConfigContext)
}

// Returns whether the latest deployment-config request failed.
export function useServerConfigError(): boolean {
  return useContext(ServerConfigErrorContext)
}

// Convenience: the admin-configured site name, falling back to the default while config is still
// loading or when the admin hasn't set one.
export function useSiteName(): string {
  return resolveSiteName(useContext(ServerConfigContext)?.siteName)
}

// Convenience: the gatekeeper vendors offered as sign-in methods (empty until config loads / none).
export function useAuthVendors(): AuthVendorInfo[] {
  return useContext(ServerConfigContext)?.authVendors ?? []
}

// Convenience: whether the Cloudflare limits / top-up flow is enabled.
export function useCloudflareLimitsEnabled(): boolean {
  return useContext(ServerConfigContext)?.cloudflareLimitsEnabled ?? false
}
