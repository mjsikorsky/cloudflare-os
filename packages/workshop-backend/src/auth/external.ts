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

/** Validate and snapshot a host admission before exposing any RPC capability. */
export function validateExternalIdentity(
    identity: ExternalIdentity, requestUrl: string, now = Date.now()): Readonly<ExternalIdentity> {
  if (!identity || typeof identity.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9@._+\-]{0,255}$/.test(identity.id)
      || typeof identity.logoutUrl !== "string" || !identity.logoutUrl.trim()
      || typeof identity.name !== "string" || !identity.name.trim() || identity.name.length > 200
      || !Number.isSafeInteger(identity.expiresAt) || identity.expiresAt <= now
      || identity.expiresAt > now + 300_000) {
    throw new Error("Invalid external identity admission.");
  }
  const logout = new URL(identity.logoutUrl, requestUrl);
  if (logout.origin !== new URL(requestUrl).origin || logout.username || logout.password) {
    throw new Error("External sign-out must use the host origin.");
  }
  return Object.freeze({ id: identity.id, name: identity.name,
    expiresAt: identity.expiresAt, logoutUrl: logout.pathname + logout.search + logout.hash });
}
