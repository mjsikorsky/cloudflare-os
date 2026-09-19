import type {RpcTarget} from 'capnweb';

/** Native metadata fencing one authored slot. */
export type CompositionToken = {
  /** Native instance incarnation; never derived from a title or URL. */
  instanceEpoch: string;
  /** Installed native serializer/path rules revision. */
  registrationRevision: number;
  /** Monotone accepted revision, retained across deletion/recreation. */
  slotRevision: number;
  /** Native SHA-256 of exact UTF-8 content, or null for an absent/deleted slot. */
  digest: string | null;
};
/** One original authored value in accepted CF-OS source. */
export type CompositionSlot = {
  /** Adapter-owned stable slot identity. */
  id: string;
  /** The complete native concurrency token. */
  token: CompositionToken;
  /** Exact authored content; null means a native tombstone/creation token. */
  bytes: string | null;
};
/** Initial declaration installed explicitly by the native workspace owner. */
export type CompositionInitialSlot = {
  /** Stable slot identity. */
  id: string;
  /** Managed source path under legion/state/, excluding index.json. */
  path: string;
  /** Native serializer that validates future source and proposal mutations. */
  serializerId: 'text/1' | 'json/1';
  /** Initial accepted bytes; null registers a never-created slot. */
  bytes: string | null;
};
/** A narrow original-canvas mutation; it never admits arbitrary Yjs bytes. */
export type CompositionWrite = {
  /** Exact supported wire protocol. */
  protocol: 2;
  /** Stable retry identity. Changed content under the same ID is rejected. */
  operationId: string;
  /** Atomic set of slot changes. */
  changes: readonly {
    /** Target within this capability's registered gadget. */
    slotId: string;
    /** Owner-issued base token. */
    expected: CompositionToken;
    /** Replacement bytes and their digest; null requests deletion. */
    next: {bytes: string; digest: string} | null;
  }[];
};
/** Persisted result of a synchronous source-only composition operation. */
export type CompositionReceipt = {
  /** Submitted retry identity. */
  operationId: string;
  /** Native fingerprint including actor, exact target and complete request. */
  fingerprint: string;
} & ({
  /** The native source transaction committed. */
  state: 'committed';
  /** Actual native code-log revision. */
  sourceRevision: number;
  /** Accepted mutation epoch. */
  stateRevision: number;
  /** Tokens for precisely the acknowledged slots. */
  slots: readonly {id: string; token: CompositionToken}[];
} | {
  /** No authored change from this operation committed. */
  state: 'rejected';
  /** Visible reconciliation failure. */
  reason: string;
});
/** An existing native gadget's managed authored state, retaining parent authority. */
export interface CompositionClient extends RpcTarget {
  /** Negotiate before mounting stores or dispatching managed writes. */
  compositionProtocol(): Promise<{protocol: 2; minimumReader: 2; writesEnabled: boolean; instanceEpoch: string; registrationRevision: number}>;
  /** Read source bytes with their owner-issued tokens. */
  readComposition(): Promise<{protocol: 2; sourceRevision: number; stateRevision: number; slots: readonly CompositionSlot[]}>;
  /** Apply a revision-bound atomic authored mutation through native source history. */
  applyCompositionChanges(input: CompositionWrite): Promise<CompositionReceipt>;
  /** Resolve the same operation after an uncertain transport result. */
  readCompositionOperation(operationId: string): Promise<CompositionReceipt | {state: 'absent'}>;
}
