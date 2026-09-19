import {createHash} from 'node:crypto';
import * as Y from 'yjs';
import {collection, createTypedStorage} from '@gadgets/typed-storage';
import type {CompositionReceipt} from '@gadgets/workshop-shared/composition';

/** Native precondition for one managed authored slot. */
export type CompositionSlotToken = {
  instanceEpoch: string; registrationRevision: number; slotRevision: number; digest: string | null;
};
/** Trusted native registration, independent of editable source/index files. */
export type CompositionRegistration = {
  gadgetId: number; instanceEpoch: string; registrationRevision: number;
  adapterId: string; adapterDigest: string; serializerRegistryDigest: string;
  schemaVersion: 2; status: 'ready' | 'invalid'; writesEnabled: boolean;
  slots: Record<string, {path: string; serializerId: 'text/1' | 'json/1'}>;
};
/** Derived concurrency guard. Deletion retains the record and monotone revision. */
export type CompositionGuard = CompositionSlotToken & {
  key: string; gadgetId: number; slotId: string; path: string;
  serializerId: 'text/1' | 'json/1'; tombstone: boolean; changedAtCodeVersion: number;
};
/** Native operation evidence contains no second copy of authored bytes. */
export type CompositionOperation = {
  key: string; gadgetId: number; operationId: string; actorId: string;
  fingerprint: string; createdAt: number;
  result: CompositionReceipt;
};

/** Replay identity for explicit creation; authored bytes remain in native source. */
export type CompositionCreation = {
  operationId: string; actorId: string; fingerprint: string; gadgetId: number;
};

/** These collections extend the existing Overseer schema, not another DO. */
export const compositionCollections = {
  compositionChats: collection<CompositionCreation & {chatId: number}>()({primaryKey: 'operationId'}),
  compositionCreations: collection<CompositionCreation>()({primaryKey: 'operationId'}),
  compositionRegistrations: collection<CompositionRegistration>()({primaryKey: 'gadgetId'}),
  compositionSlotGuards: collection<CompositionGuard>()({primaryKey: 'key'}),
  compositionOperations: collection<CompositionOperation>()({primaryKey: 'key'}),
};
/** Derive the exact typed-storage shape without reproducing its storage API. */
function storageType(storage: DurableObjectStorage) {
  return createTypedStorage(storage, {collections: compositionCollections});
}
type CompositionStorage = ReturnType<typeof storageType>;
const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const key = (gadgetId: number, id: string) => JSON.stringify([gadgetId, id]);
const indexPath = 'legion/state/index.json';
const token = (guard: CompositionGuard): CompositionSlotToken => ({
  instanceEpoch: guard.instanceEpoch, registrationRevision: guard.registrationRevision,
  slotRevision: guard.slotRevision, digest: guard.digest,
});

/** Deterministic object encoding for native fingerprints and generated projections. */
export function canonicalComposition(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const result = JSON.stringify(value);
    if (result === undefined) throw new Error('Non-JSON composition value.');
    return result;
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalComposition).join(',') + ']';
  return '{' + Object.keys(value).toSorted().map(k => JSON.stringify(k) + ':'
    + canonicalComposition((value as Record<string, unknown>)[k])).join(',') + '}';
}

/** A registration's rules are installed at the native owner, never from index.json. */
export function validateCompositionRegistration(registration: CompositionRegistration): void {
  if (!Number.isSafeInteger(registration.gadgetId) || registration.gadgetId < 0
      || registration.schemaVersion !== 2 || !registration.instanceEpoch
      || !Number.isSafeInteger(registration.registrationRevision) || registration.registrationRevision < 1
      || !registration.adapterId || !/^[a-f0-9]{64}$/.test(registration.adapterDigest)
      || !/^[a-f0-9]{64}$/.test(registration.serializerRegistryDigest)
      || !registration.slots || typeof registration.slots !== 'object' || Array.isArray(registration.slots)) throw new Error('Invalid native composition registration.');
  const paths = new Set<string>();
  for (const [id, rule] of Object.entries(registration.slots)) {
    if (!id || id.length > 2048 || !rule || typeof rule.path !== 'string'
        || !rule.path.startsWith('legion/state/') || rule.path === indexPath
        || rule.path.split('/').some(part => !part || part === '.' || part === '..')
        || [...rule.path].some(char => char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || paths.has(rule.path)
        || !['text/1', 'json/1'].includes(rule.serializerId)) throw new Error('Invalid native composition slot rule.');
    paths.add(rule.path);
  }
}

/** Prepare every registered root from the owner-current candidate document.
 * The caller commits the repaired update and these guards in the same native
 * transaction. Call this for raw source writes and proposal acceptance too. */
export function prepareCompositionGuards(options: {
  storage: CompositionStorage; candidate: Y.Doc; sourceVersion: number;
  gadgets: ReadonlyMap<number, {root: string; pending?: unknown}>;
}) {
  const guards: CompositionGuard[] = [];
  const changedSlots: Array<{gadgetId: number; slotId: string}> = [];
  for (const registration of options.storage.compositionRegistrations.list()) {
    const gadget = options.gadgets.get(registration.gadgetId);
    // The native registry controls membership. A retained Yjs root is not a gadget.
    if (!gadget || gadget.pending || registration.status !== 'ready') continue;
    validateCompositionRegistration(registration);
    const files = options.candidate.getMap<Y.Text>(gadget.root);
    const allowed = new Set(Object.values(registration.slots).map(rule => rule.path));
    for (const [path, value] of files) {
      if (!path.startsWith('legion/state/')) continue;
      if (path === indexPath) continue; // discard/repair all submitted projection bytes below
      if (!allowed.has(path) || !(value instanceof Y.Text)) throw new Error('Unregistered managed composition source.');
    }
    const projection: Array<{id: string; path: string; serializerId: string; token: CompositionSlotToken}> = [];
    for (const [id, rule] of Object.entries(registration.slots).toSorted(([a], [b]) => a.localeCompare(b))) {
      const content = files.get(rule.path);
      if (content !== undefined && !(content instanceof Y.Text)) throw new Error('Managed composition source is not text.');
      const bytes = content?.toString() ?? null;
      if (bytes !== null && rule.serializerId === 'json/1') {
        try { JSON.parse(bytes); } catch { throw new Error('Managed composition JSON is incomplete; retain the pending edit.'); }
      }
      const digest = bytes === null ? null : hash(bytes);
      const previous = options.storage.compositionSlotGuards.get(key(registration.gadgetId, id));
      if (previous && previous.instanceEpoch !== registration.instanceEpoch) throw new Error('Native instance epoch changed without registration recovery.');
      const changed = !previous ? bytes !== null : previous.digest !== digest
        || previous.registrationRevision !== registration.registrationRevision
        || previous.serializerId !== rule.serializerId || previous.path !== rule.path;
      const guard: CompositionGuard = {
        key: key(registration.gadgetId, id), gadgetId: registration.gadgetId, slotId: id,
        path: rule.path, serializerId: rule.serializerId, instanceEpoch: registration.instanceEpoch,
        registrationRevision: registration.registrationRevision,
        slotRevision: (previous?.slotRevision ?? 0) + Number(changed), digest,
        tombstone: bytes === null, changedAtCodeVersion: changed ? options.sourceVersion : previous?.changedAtCodeVersion ?? 0,
      };
      guards.push(guard);
      if (changed) changedSlots.push({gadgetId: registration.gadgetId, slotId: id});
      projection.push({id, path: rule.path, serializerId: rule.serializerId, token: token(guard)});
    }
    const projected = canonicalComposition({protocol: 2, slots: projection});
    const oldIndex = files.get(indexPath);
    if (!(oldIndex instanceof Y.Text) || oldIndex.toString() !== projected) {
      // Repair against the owner-current document. Never merge a client index as authority.
      files.set(indexPath, new Y.Text(projected));
    }
  }
  return {guards, changedSlots};
}

/** Read bytes from accepted native source; guard rows store only metadata. */
export function readCompositionState(storage: CompositionStorage, doc: Y.Doc, gadgetId: number, root: string) {
  const registration = storage.compositionRegistrations.get(gadgetId);
  if (!registration || registration.status !== 'ready') throw new Error('Native composition registration is not ready.');
  validateCompositionRegistration(registration);
  const files = doc.getMap<Y.Text>(root);
  return Object.entries(registration.slots).map(([id, rule]) => {
    const guard = storage.compositionSlotGuards.get(key(gadgetId, id));
    if (!guard) throw new Error('Native composition guards require a rebuild.');
    const bytes = files.get(rule.path)?.toString() ?? null;
    if (guard.digest !== (bytes === null ? null : hash(bytes))) throw new Error('Native composition guard does not match accepted source.');
    return {id, token: token(guard), bytes};
  });
}

/** Construct one narrow human mutation against the owner-current source. */
export function applyCompositionToCandidate(options: {
  storage: CompositionStorage; candidate: Y.Doc; gadgetId: number; root: string;
  changes: readonly {slotId: string; expected: CompositionSlotToken; next: {bytes: string; digest: string} | null}[];
}) {
  const registration = options.storage.compositionRegistrations.get(options.gadgetId);
  if (!registration || registration.status !== 'ready') throw new Error('Native composition registration is not ready.');
  const seen = new Set<string>();
  const files = options.candidate.getMap<Y.Text>(options.root);
  for (const change of options.changes) {
    if (!change || seen.has(change.slotId) || !Object.hasOwn(registration.slots, change.slotId)) throw new Error('Invalid composition slot mutation.');
    seen.add(change.slotId);
    const guard = options.storage.compositionSlotGuards.get(key(options.gadgetId, change.slotId));
    if (!guard || canonicalComposition(token(guard)) !== canonicalComposition(change.expected)) throw new Error('Composition slot changed; preserve and reconcile this edit.');
    const rule = registration.slots[change.slotId];
    if (change.next === null) files.delete(rule.path);
    else {
      if (!change.next || typeof change.next.bytes !== 'string' || hash(change.next.bytes) !== change.next.digest) throw new Error('Composition content digest mismatch.');
      files.set(rule.path, new Y.Text(change.next.bytes));
    }
  }
}
