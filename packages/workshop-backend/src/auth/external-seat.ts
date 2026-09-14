import {validateExternalIdentity, type ExternalIdentity} from "./external.js";

/** A trusted embedding host's live authority, supplied locally, never through client RPC.
 * Revalidation must check current execution authority, not extend an expired admission proof.
 * The signal ends the whole connection, including any in-flight revalidation.
 */
export interface ExternalConnectionAuthority {
  /** Opaque host-owned execution scope; renewal cannot replace this scope. */
  readonly scope: string;
  readonly signal: AbortSignal;
  readonly revalidate: (identity: Readonly<ExternalIdentity>, signal: AbortSignal)
    => Promise<{readonly identity: ExternalIdentity; readonly scope: string} | undefined>;
}

/** Own one native transport's finite admission without replacing its RPC capabilities. */
export class ExternalAdmissionSeat {
  #identity: Readonly<ExternalIdentity>;
  #ended = new AbortController();
  #expiry?: ReturnType<typeof setTimeout>;
  #refresh?: ReturnType<typeof setTimeout>;
  #authoritySignal?: AbortSignal;
  #scope?: string;
  #revalidate?: ExternalConnectionAuthority["revalidate"];
  #onAuthorityEnd = () => this.close();

  constructor(identity: ExternalIdentity, private requestUrl: string,
      private abortSession: () => void, authority?: ExternalConnectionAuthority) {
    this.#identity = validateExternalIdentity(identity, requestUrl);
    if (authority) {
      if (!(authority.signal instanceof AbortSignal) || typeof authority.revalidate !== "function" ||
          typeof authority.scope !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(authority.scope)) {
        throw new Error("Invalid external connection authority.");
      }
      this.#scope = authority.scope;
      this.#authoritySignal = authority.signal;
      this.#revalidate = authority.revalidate.bind(authority);
      this.#authoritySignal.addEventListener("abort", this.#onAuthorityEnd, {once: true});
      if (this.#authoritySignal.aborted) { this.close(); return; }
    }
    this.#schedule();
  }

  /** Current native identity. An expired seat cannot authorize even before a timer runs. */
  current(): Readonly<ExternalIdentity> {
    if (this.#ended.signal.aborted || Date.now() >= this.#identity.expiresAt) {
      this.close();
      throw new Error("External identity admission expired.");
    }
    return this.#identity;
  }

  /** End and release a transport, cancelling pending host checks exactly once. */
  close(): void {
    if (this.#ended.signal.aborted) return;
    clearTimeout(this.#expiry);
    clearTimeout(this.#refresh);
    this.#authoritySignal?.removeEventListener("abort", this.#onAuthorityEnd);
    this.#ended.abort(new Error("External connection authority ended."));
    this.abortSession();
  }

  #schedule(advanced = true): void {
    const remaining = this.#identity.expiresAt - Date.now();
    this.#expiry ??= setTimeout(() => this.close(), Math.max(0, remaining));
    if (this.#revalidate) {
      this.#refresh = setTimeout(() => { void this.#renew(); },
          Math.max(1, Math.min(30_000, advanced ? Math.floor(remaining / 2) : remaining)));
    }
  }

  async #renew(): Promise<void> {
    try {
      const previous = this.current();
      // The existing deadline stays armed during the asynchronous host check. A hung or
      // cancelled callback cannot keep authority alive; a late result cannot revive it.
      const result = await this.#revalidate!(previous, this.#ended.signal);
      this.current();
      if (!result) throw new Error("External authority denied.");
      const next = validateExternalIdentity(result.identity, this.requestUrl);
      if (result.scope !== this.#scope || next.id !== previous.id ||
          next.name !== previous.name || next.logoutUrl !== previous.logoutUrl) {
        throw new Error("External authority changed.");
      }
      this.#identity = next;
      // A fresh check may confirm the same final ceiling or narrow it. Neither extends
      // access. Keep an unchanged deadline armed and avoid halving its last window.
      if (next.expiresAt !== previous.expiresAt) {
        clearTimeout(this.#expiry);
        this.#expiry = undefined;
      }
      this.#schedule(next.expiresAt > previous.expiresAt);
    } catch {
      this.close();
    }
  }
}
