/** A verifier seat: a person with no account of their own, admitted by a trusted embedding host to
 * use exactly one gadget through an existing "use" grant. The host mints the native identity in a
 * reserved namespace so that it can never be admitted to the account API, and redeems the grant
 * server-side; the raw share key is never handed to a browser.
 */
export const VERIFIER_ID_PREFIX = "openv-";

export interface ExternalVerifierTarget {
  /** The one workspace this connection may open. */
  readonly gadgetId: string;
  /** Raw key of a "use" share link on that workspace, redeemed natively at open. Optional when the
   * verifier identity already holds a grant from an earlier redemption. */
  readonly shareKey?: string;
}

export function isVerifierIdentityId(id: unknown): boolean {
  return typeof id === "string" && id.startsWith(VERIFIER_ID_PREFIX);
}

/** Snapshot the destination before native account/workspace admission awaits anything.
 * Native openGadget/redeemShareKey still own sharing, observer and role decisions.
 */
export function validateExternalVerifierTarget(target: ExternalVerifierTarget): Readonly<ExternalVerifierTarget> {
  const snapshot = Object.freeze({gadgetId: target?.gadgetId,
    ...(target?.shareKey === undefined ? {} : {shareKey: target.shareKey})});
  if (typeof snapshot.gadgetId !== "string" || !/^[a-f0-9]{64}$/.test(snapshot.gadgetId)
      || (snapshot.shareKey !== undefined
          && (typeof snapshot.shareKey !== "string" || !/^[a-f0-9]{2,512}$/.test(snapshot.shareKey)))) {
    throw new Error("Invalid external verifier target.");
  }
  return snapshot;
}
