/** A connection admission supplied by a trusted embedding host, never by HTTP headers.
 * The host verifies identity and current access before every admission. `id` must be a stable,
 * host-namespaced native principal; it must not be shared by different people.
 */
export interface ExternalIdentity {
  /** Stable native account key chosen by the authenticated host. */
  id: string;
  /** Initial display name; existing profile preferences are preserved. */
  name: string;
  /** Absolute epoch milliseconds when this connection must lose access. */
  expiresAt: number;
  /** Same-origin host sign-out page, reached by a top-level navigation. */
  logoutUrl: string;
}

/** A signed-out visitor admitted by a trusted embedding host to the public surface only
 * (deployment configuration and public blueprints). There is no account behind this connection;
 * the host signs people in on its own pages.
 */
export interface ExternalVisitor {
  /** Same-origin host sign-in page, reached by a top-level navigation. */
  loginUrl: string;
  /** Same-origin host sign-out page, reached by a top-level navigation. */
  logoutUrl: string;
}

/** A host page reference, kept as a path on the host origin. */
function hostPath(value: unknown, requestUrl: string, what: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid external ${what} admission.`);
  const url = new URL(value, requestUrl);
  if (url.origin !== new URL(requestUrl).origin || url.username || url.password) {
    throw new Error(`External ${what} must use the host origin.`);
  }
  return url.pathname + url.search + url.hash;
}

/** Validate and snapshot a host admission before exposing any RPC capability. */
export function validateExternalIdentity(
    identity: ExternalIdentity, requestUrl: string, now = Date.now()): Readonly<ExternalIdentity> {
  if (!identity || typeof identity.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9@._+-]{0,255}$/.test(identity.id)
      || typeof identity.logoutUrl !== "string" || !identity.logoutUrl.trim()
      || typeof identity.name !== "string" || !identity.name.trim() || identity.name.length > 200
      || !Number.isSafeInteger(identity.expiresAt) || identity.expiresAt <= now
      || identity.expiresAt > now + 300_000) {
    throw new Error("Invalid external identity admission.");
  }
  return Object.freeze({ id: identity.id, name: identity.name,
    expiresAt: identity.expiresAt, logoutUrl: hostPath(identity.logoutUrl, requestUrl, "sign-out") });
}

/** Validate and snapshot a host visitor admission before exposing the public RPC surface. */
export function validateExternalVisitor(
    visitor: ExternalVisitor, requestUrl: string): Readonly<ExternalVisitor> {
  if (!visitor || typeof visitor !== "object") throw new Error("Invalid external visitor admission.");
  return Object.freeze({ loginUrl: hostPath(visitor.loginUrl, requestUrl, "sign-in"),
    logoutUrl: hostPath(visitor.logoutUrl, requestUrl, "sign-out") });
}
