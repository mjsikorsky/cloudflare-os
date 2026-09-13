import { createFileRoute } from '@tanstack/react-router'
import { useRpcStub } from '../RpcContext'
import { CF_ACCESS_MODE } from '../useAuth'
import { Navigate } from '@tanstack/react-router'
import SignupPage from '../SignupPage'
import { useServerConfig, useServerConfigError } from '../ServerConfigContext'

export const Route = createFileRoute('/signup')({
  component: SignupRoute,
})

function SignupRoute() {
  const rpcStub = useRpcStub()
  const config = useServerConfig()
  const configError = useServerConfigError()
  if (configError) return <p role="alert">The server authentication configuration could not be loaded.</p>
  if (!config) return <p role="status">Loading…</p>
  // Externally managed identity uses the host or Access sign-up flow.
  if (CF_ACCESS_MODE || config.externalAuthentication) {
    return <Navigate to="/" replace />
  }
  return <SignupPage rpcStub={rpcStub} />
}
