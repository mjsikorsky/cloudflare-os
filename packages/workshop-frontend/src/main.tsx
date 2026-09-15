import { useServerConfigConnection } from './useServerConfigConnection'
import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { RpcStub, newWebSocketRpcSession } from 'capnweb'
import { PublicApi, resolveSiteName } from '@gadgets/workshop-shared/api'
import { RpcContext } from './RpcContext'
import { ServerConfigContext, ServerConfigErrorContext, ConnectionConfigContext } from './ServerConfigContext'
import { ThemeProvider } from './ThemeContext'
import { createRouter } from './router'
import AnnouncementBanner from './components/AnnouncementBanner'
import { applyAccentColor, applyStoredAccentColor, applyStoredThemeMode, writeStoredAccentColor } from './theme'
import './styles.css'
import FrontendErrorBoundary from './FrontendErrorBoundary'
import { installWorkshopErrorReporting, reportIssue } from './errorReporting'
import { applySiteFavicon } from './siteLogoUtils'

// ---------------------------------------------------------------------------
// Dev auto-login: if VITE_DEV_AUTO_LOGIN=true, automatically create/login
// with the dev account before React renders, so you never see the login page.
// ---------------------------------------------------------------------------
async function devAutoLogin(stub: RpcStub<PublicApi>): Promise<void> {
  if (import.meta.env.VITE_DEV_AUTO_LOGIN !== 'true') return
  if (localStorage.getItem('authToken')) return  // already logged in

  const username = import.meta.env.VITE_DEV_USERNAME ?? 'dev'
  const password = import.meta.env.VITE_DEV_PASSWORD ?? 'devpassword'

  // Derive the passwordHash the same way the app does (argon2id via hashPassword),
  // but here we use the same SERVICE_SALT + SHA-256 shortcut that wrangler dev accepts
  // in local mode. We import hashPassword from the existing util.
  const { hashPassword } = await import('./passwordHash')
  const passwordHash = await hashPassword(username, password)

  // Try createAccount first — works on a fresh backend. Returns null if already exists.
  let token = await stub.createAccount(username, username, passwordHash)

  // If null, account already exists — just log in.
  if (!token) {
    token = await stub.login(username, passwordHash)
  }

  if (token) {
    localStorage.setItem('authToken', token)
  }
}

// WebSocket RPC connection management.
//
// React's useEffect / useState machinery is kind of obnoxious in that, in dev mode, it runs
// everything twice (runs once, immediately cleans up, then runs again). This isn't so good for
// our WebSocket as it means we are creating redundant connections to the server and throwing
// them away instantly. It gets even worse when we start trying to handle disconnects gracefully:
// we can end up with two connections that are fighting to replace each other.
//
// Or maybe I (Kenton) was just holding it wrong, idk.
//
// Anyway, I pulled the connection management out into these globals instead.
let lastConnectTime: number = 0;
let backoff: number = 1000;

function getBackendHost(): string {
  const backendHost = import.meta.env.VITE_BACKEND_HOST?.trim();
  if (backendHost) return backendHost;

  // When opening the Vite dev server directly (localhost:3000), the backend is at localhost:8787.
  // Otherwise, the API is on the same host as the frontend.
  return window.location.hostname === 'localhost' ? 'localhost:8787' : window.location.host;
}

function startConnection(): RpcStub<PublicApi> {
  lastConnectTime = Date.now();
  const apiHost = getBackendHost();
  const wsUrl = (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + apiHost + '/api';
  return newWebSocketRpcSession<PublicApi>(wsUrl);
}

async function handleBroken(error: any) {
  console.warn('RPC connection lost:', error);

  isConnectionLost = true;
  for (let cb of notifyCurrentStubUpdated) { cb(); }

  let timeSinceConnect = Date.now() - lastConnectTime;
  if (timeSinceConnect < backoff) {
    let waitTime = backoff - timeSinceConnect;
    console.warn(`Will try again in ${Math.round(waitTime / 1000)} seconds...`)
    await new Promise(resolve => setTimeout(resolve, waitTime));
    console.warn(`Retrying connection...`);
    backoff = Math.min(backoff * 2, 10000);
  } else {
    backoff = 1000;
  }

  currentStub = startConnection();
  currentStub.onRpcBroken(handleBroken);

  // Don't clear isConnectionLost here — the new connection hasn't proven
  // it works yet. It gets cleared by markConnectionRestored() once the
  // app successfully communicates with the backend.
  for (let cb of notifyCurrentStubUpdated) {
    cb();
  }
}

// Callbacks to call whenever `currentStub` or connection state is updated.
let notifyCurrentStubUpdated: Set<() => void> = new Set();
let isConnectionLost = false;

// Called externally (e.g., by auth) to indicate the connection is alive.
export function markConnectionRestored() {
  if (!isConnectionLost) return;
  isConnectionLost = false;
  for (let cb of notifyCurrentStubUpdated) { cb(); }
}

// Current stub. handleBroken() will replace this on disconnect.
installWorkshopErrorReporting()
let currentStub = startConnection();
currentStub.onRpcBroken(handleBroken);

const router = createRouter()
applyStoredThemeMode()
applyStoredAccentColor()

function AppWithConnection() {
  const [rpcState, setRpcState] = useState<{stub: RpcStub<PublicApi>; connectionLost: boolean}>({
    stub: currentStub,
    connectionLost: isConnectionLost,
  });
  const { config: connectionConfig, error: serverConfigError, lastKnown } = useServerConfigConnection(rpcState.stub);
  // What the page shows follows the last configuration any connection supplied; a replacement
  // connection after a disconnect must not blank the site name, logo or accent while it answers.
  const serverConfig = connectionConfig ?? lastKnown;

  useEffect(() => {
    let cb = () => setRpcState({ stub: currentStub, connectionLost: isConnectionLost });
    notifyCurrentStubUpdated.add(cb);
    return () => { notifyCurrentStubUpdated.delete(cb); };
  }, []);

  // Apply the deployment's admin-chosen accent color (overrides brand CSS vars at runtime) once
  // its configuration has arrived, and remember it for the next load's first paint. Before that
  // the remembered accent stays in place.
  useEffect(() => {
    if (!serverConfig) return;
    applyAccentColor(serverConfig.accentColor ?? '');
    writeStoredAccentColor(serverConfig.accentColor);
  }, [serverConfig, serverConfig?.accentColor]);

  // The tab shows this deployment's name and mark only once its configuration has arrived; the
  // static page carries neither. A route that sets its own document title keeps it.
  useEffect(() => {
    if (!serverConfig) return;
    if (!document.title) document.title = resolveSiteName(serverConfig.siteName);
    return applySiteFavicon(serverConfig.siteLogo?.url);
  }, [serverConfig]);

  return (
    <ThemeProvider>
      <RpcContext.Provider value={rpcState}>
        <ServerConfigErrorContext.Provider value={serverConfigError}>
          <ServerConfigContext.Provider value={serverConfig}>
            <ConnectionConfigContext.Provider value={connectionConfig}>
              <AnnouncementBanner />
              <RouterProvider router={router} />
            </ConnectionConfigContext.Provider>
          </ServerConfigContext.Provider>
        </ServerConfigErrorContext.Provider>
      </RpcContext.Provider>
    </ThemeProvider>
  );
}

const root = createRoot(document.getElementById('root')!, {
  onUncaughtError: (error) => reportIssue('workshop.react-root', error, {
    handled: false, severity: 'fatal', captureMechanism: 'react',
  }),
})

// Kick off dev auto-login in the background. If it completes before
// useAuth checks the token, the user skips the login page. If the backend
// is unreachable, the app still renders immediately (showing a connection
// banner or login page) instead of hanging on a blank screen.
devAutoLogin(currentStub).catch(() => {})

root.render(
  <StrictMode>
    <FrontendErrorBoundary>
      <AppWithConnection />
    </FrontendErrorBoundary>
  </StrictMode>
)
