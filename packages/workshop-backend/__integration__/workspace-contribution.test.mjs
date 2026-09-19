import { before, after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newWebSocketRpcSession } from 'capnweb';
import * as Y from 'yjs';
import { collectModules } from '../../../scripts/release/hash-lib.mjs';
import { readWranglerConfig } from '../../../scripts/release/manifest-lib.mjs';

// The client lives outside workerd: caught RPC rejections in a same-workerd client are
// independently reported as unhandled by that test runtime. Nothing is suppressed here.
// The backend is the real Wrangler/validator output with native User/Overseer SQLite state.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireWrangler = createRequire(realpathSync(join(packageRoot, 'node_modules/wrangler/package.json')));
const { Miniflare } = requireWrangler('miniflare');
let runtime;
const retained = [];
function retain(capability) { retained.push(capability); return capability; }
const author = {id: 'dsh:isolated-session', name: 'DSH test agent'};

before(async () => {
  const output = mkdtempSync(join(tmpdir(), 'cfos-contribution-native-'));
  execFileSync('pnpm', ['run', 'build:format-blueprints'], {cwd: packageRoot, stdio: 'inherit'});
  execFileSync('pnpm', ['exec', 'wrangler', 'deploy', '--config', 'wrangler.jsonc', '--dry-run', '--outdir', output], {
    cwd: packageRoot, stdio: 'inherit', env: {...process.env, WRANGLER_SEND_METRICS: 'false'},
  });
  const config = readWranglerConfig(packageRoot);
  const bundle = collectModules(output);
  const types = {esm: 'ESModule', text: 'Text', wasm: 'CompiledWasm', data: 'Data'};
  const modulesRoot = '/native-contribution-test';
  const modules = bundle.modules.map(module => ({
    type: types[module.type], path: join(modulesRoot, module.name),
    contents: ['esm', 'text'].includes(module.type) ? module.bytes.toString('utf8') : module.bytes,
  }));
  modules.sort((a, b) => Number(b.path === join(modulesRoot, bundle.mainModule)) - Number(a.path === join(modulesRoot, bundle.mainModule)));
  // Fixture-only trusted host composition. Claims are selected by the Node test, not verified
  // production credentials. Everything below this boundary is the actual native backend.
  modules.unshift({type: 'ESModule', path: join(modulesRoot, 'fixture-entry.mjs'), contents: `
    import server, {fetchWithContribution} from './${bundle.mainModule}';
    export * from './${bundle.mainModule}';
    const controls = new Map();
    export default {async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.pathname === '/fixture-control') {
        const state = controls.get(url.searchParams.get('key'));
        if (url.searchParams.get('revoke') && state) state.allowed = false;
        return Response.json({checks: state?.checks ?? 0});
      }
      if (url.pathname !== '/fixture-contribution') return server.fetch(request, env, ctx);
      const key = request.headers.get('fixture-key');
      const state = {checks: 0, allowed: true, controller: new AbortController()};
      controls.set(key, state);
      const target = JSON.parse(request.headers.get('fixture-target'));
      const identity = {id: request.headers.get('fixture-person'), name: 'Host initial name',
        expiresAt: Date.now() + 2000, logoutUrl: '/sign-out'};
      const authority = {scope: key, signal: state.controller.signal, async revalidate(previous, signal) {
        signal.throwIfAborted(); state.checks++;
        if (!state.allowed) return undefined;
        return {identity: {...previous, expiresAt: Date.now() + 2000}, scope: key};
      }};
      return fetchWithContribution(new Request('https://workshop.invalid/api', request),
        env, ctx, identity, target, authority);
    }};
  `});
  runtime = new Miniflare({modulesRoot, modules,
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    durableObjects: Object.fromEntries(config.migrations.flatMap(migration => migration.new_sqlite_classes ?? [])
      .map(className => [className, {className, useSQLite: true}])),
    kvNamespaces: ['BLUEPRINTS', 'AVATARS'], r2Buckets: ['BLUEPRINT_CONTENT'],
    bindings: {PUBLIC_BASE_URL: 'https://workshop.invalid'},
    workerLoaders: {LOADER: {}},
    // This fixture invokes no model, gatekeeper, browser, Loader or provider operation.
  });
}, {timeout: 120000});
afterEach(() => {
  for (const item of retained.splice(0).toReversed()) { try { item[Symbol.dispose](); } catch {} }
});
after(async () => { await runtime?.dispose(); });

async function person() {
  const response = await runtime.dispatchFetch('https://workshop.invalid/api', {headers: {Upgrade: 'websocket'}});
  assert.equal(response.status, 101);
  const socket = response.webSocket;
  assert.ok(socket); socket.accept();
  retain({[Symbol.dispose]() { socket.close(1000, 'test completed'); }});
  const api = retain(newWebSocketRpcSession(socket));
  const name = 'contribution_' + crypto.randomUUID().replaceAll('-', '');
  const token = await api.createAccount(name, name, new Uint8Array([1, 2, 3]));
  assert.ok(token, 'Native account initialization succeeds');
  return {name, socket, account: retain(await api.authenticate(token))};
}
function addFile(update, filesRoot, file, contents) {
  const doc = new Y.Doc();
  try {
    Y.applyUpdateV2(doc, update);
    const before = Y.encodeStateVector(doc);
    doc.getMap(filesRoot).set(file, new Y.Text(contents));
    return Y.encodeStateAsUpdateV2(doc, before);
  } finally { doc.destroy(); }
}
function fileText(update, filesRoot, file) {
  const doc = new Y.Doc();
  try { Y.applyUpdateV2(doc, update); return doc.getMap(filesRoot).get(file)?.toString(); }
  finally { doc.destroy(); }
}
async function expectRejectedContribution(pending, pattern) {
  // Consume both the rejected future capability and its pipelined operation.
  const creation = Promise.resolve(pending).then(cap => { cap[Symbol.dispose](); return null; }, error => error);
  const info = Promise.resolve(pending.getInfo()).then(() => null, error => error);
  const errors = await Promise.all([creation, info]);
  for (const error of errors) { assert.ok(error); assert.match(error.message, pattern); }
  pending[Symbol.dispose]();
}
async function eventuallyRejected(call, pattern) {
  const deadline = Date.now() + 3000;
  do {
    try { await call(); } catch (error) { if (pattern) assert.match(error.message, pattern); return; }
    await new Promise(resolve => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  assert.fail('Held contribution retained authority after native invalidation');
}

test('native proposals remain provisional, chat-bound and separately attributed from the human request', {timeout: 30000}, async () => {
  const owner = await person();
  const workspace = retain(await owner.account.newGadget());
  const chat = await workspace.newChat('External contribution', null);
  const otherChat = await workspace.newChat('Unrelated human draft', null);
  const contribution = retain(await workspace.createContribution(chat, author));
  const initial = await contribution.observe();
  assert.deepEqual(await contribution.getInfo(), {workspaceId: (await workspace.getMetadata()).id, chatId: chat,
    author: {type: 'agent', ...author}});
  const gadget = await contribution.createGadget('Proposed work', 'PROPOSED_WORK');
  assert.equal(gadget.chatId, chat);
  const created = await contribution.observe();
  assert.equal(created.workpieces.find(item => item.id === gadget.id)?.chatId, chat);
  await contribution.proposeCode(addFile(created.update, gadget.filesRoot, 'agent.txt', 'pending agent work'));
  assert.equal(fileText((await contribution.observe()).update, gadget.filesRoot, 'agent.txt'), 'pending agent work');
  const unrelated = retain(await workspace.createContribution(otherChat, {id: 'other', name: 'Other'}));
  assert.equal((await unrelated.observe()).workpieces.some(item => item.id === gadget.id), false);
  assert.equal(fileText((await unrelated.observe()).update, gadget.filesRoot, 'agent.txt'), undefined);
  await unrelated.proposeCode(addFile(initial.update, '', 'other.txt', 'unrelated pending draft'));
  const beforeOther = await workspace.getChatHistory(otherChat);
  await contribution.finalizeDraft();
  assert.deepEqual(await workspace.getChatHistory(otherChat), beforeOther);
  const history = await workspace.getChatHistory(chat);
  const request = history.messages.find(message => message.type === 'message' && message.message === 'External contribution');
  assert.deepEqual(request?.author, await owner.account.whoami());
  assert.equal(request?.author.type, 'user');
  const changes = history.messages.filter(message => message.type === 'changes');
  assert.ok(changes.length >= 2);
  for (const message of changes) assert.deepEqual(message.author, {type: 'agent', ...author});
  assert.equal((await workspace.listChats()).find(item => item.id === chat)?.hasProposedChanges, true);
  for (const method of ['mergeChanges', 'revertChanges', 'approveAction', 'updateCode', 'getGadget', 'createContribution']) {
    await assert.rejects(Promise.resolve(contribution[method](chat, null)), /not a function/);
  }
  // Human acceptance names the actual native sequence. A null sequence after finalizing
  // the draft is intentionally a native no-op, not shorthand for accepting all changes.
  await workspace.mergeChanges(chat, changes.at(-1).sequence);
  const accepted = await unrelated.observe();
  const acceptedWorkpiece = accepted.workpieces.find(item => item.id === gadget.id);
  assert.ok(acceptedWorkpiece);
  assert.equal(acceptedWorkpiece.chatId, undefined);
  assert.equal(fileText(accepted.update, gadget.filesRoot, 'agent.txt'), 'pending agent work');
  assert.ok(accepted.codeVersion > initial.codeVersion);
  const decision = (await workspace.getChatHistory(chat)).messages.find(message => message.type === 'merge');
  assert.deepEqual(decision?.author, await owner.account.whoami());
});

test('use-only authority and a nonexistent chat cannot mint a contribution', {timeout: 30000}, async () => {
  const owner = await person(); const viewer = await person();
  const workspace = retain(await owner.account.newGadget());
  const id = (await workspace.getMetadata()).id;
  const chat = await workspace.newChat('Native chat', null);
  await expectRejectedContribution(workspace.createContribution(999999, author), /No such chatId/);
  await workspace.addCollaborator(viewer.name, 'use');
  const view = retain(await viewer.account.openGadget(id));
  await expectRejectedContribution(view.createContribution(chat, author), /only has permission to use/);
});

test('disposing the authorized parent invalidates an already-held child', {timeout: 30000}, async () => {
  const owner = await person();
  const workspace = retain(await owner.account.newGadget());
  const chat = await workspace.newChat('Delegated chat', null);
  const contribution = retain(await workspace.createContribution(chat, author));
  assert.equal((await contribution.getInfo()).chatId, chat);
  workspace[Symbol.dispose]();
  await eventuallyRejected(() => contribution.getInfo(), /access ended/);
});

test('native sharing revocation invalidates an already-held contribution', {timeout: 30000}, async () => {
  const owner = await person(); const collaborator = await person();
  const workspace = retain(await owner.account.newGadget());
  const id = (await workspace.getMetadata()).id;
  const chat = await workspace.newChat('Shared contribution', null);
  await workspace.addCollaborator(collaborator.name, 'build');
  const shared = retain(await collaborator.account.openGadget(id));
  const contribution = retain(await shared.createContribution(chat, author));
  assert.equal((await contribution.getInfo()).workspaceId, id);
  await workspace.removeCollaborator(collaborator.name, []);
  await eventuallyRejected(() => contribution.getInfo());
});

test('native human rejection removes provisional work and records the human decision', {timeout: 30000}, async () => {
  const owner = await person();
  const workspace = retain(await owner.account.newGadget());
  const chat = await workspace.newChat('Create something to review', null);
  const contribution = retain(await workspace.createContribution(chat, author));
  const gadget = await contribution.createGadget('Rejected work', 'REJECTED_WORK');
  const observed = await contribution.observe();
  await contribution.proposeCode(addFile(observed.update, gadget.filesRoot, 'reject.txt', 'pending rejection'));
  await contribution.finalizeDraft();
  const changes = (await workspace.getChatHistory(chat)).messages.filter(message => message.type === 'changes');
  assert.ok(changes.length >= 2);
  await workspace.revertChanges(chat, changes[0].sequence);
  const rejected = await contribution.observe();
  assert.equal(rejected.workpieces.some(item => item.id === gadget.id), false);
  assert.equal(fileText(rejected.update, gadget.filesRoot, 'reject.txt'), undefined);
  const decision = (await workspace.getChatHistory(chat)).messages.find(message => message.type === 'revert');
  assert.deepEqual(decision?.author, await owner.account.whoami());
  await workspace.deleteChat(chat);
  await assert.rejects(Promise.resolve(contribution.observe()), /No such chatId/);
});


async function machineContribution(person, workspaceId, chatId) {
  const key = crypto.randomUUID();
  const response = await runtime.dispatchFetch('https://workshop.invalid/fixture-contribution', {
    headers: {Upgrade: 'websocket', Origin: 'https://workshop.invalid', 'fixture-key': key,
      'fixture-person': person.name, 'fixture-target': JSON.stringify({workspaceId, chatId, author})},
  });
  if (response.status !== 101) return {response, key};
  const socket = response.webSocket; socket.accept();
  retain({[Symbol.dispose]() {socket.close(1000, 'test completed');}});
  return {response, key, socket, contribution: retain(newWebSocketRpcSession(socket))};
}

test('machine entry retains the exact native proposal root across renewals and human acceptance', {timeout: 30000}, async () => {
  const owner = await person();
  const workspace = retain(await owner.account.newGadget());
  const id = (await workspace.getMetadata()).id;
  const chat = await workspace.newChat('Machine native proposal', null);
  const {response, contribution, key} = await machineContribution(owner, id, chat);
  assert.equal(response.status, 101);
  assert.deepEqual(await contribution.getInfo(), {workspaceId: id, chatId: chat, author: {type: 'agent', ...author}});
  for (const method of ['authenticateExternal', 'whoami', 'openGadget', 'newGadget', 'mergeChanges', 'updateCode']) {
    await assert.rejects(Promise.resolve(contribution[method]()), /not a function/);
  }
  const gadget = await contribution.createGadget('Machine draft', 'MACHINE_DRAFT');
  const observed = await contribution.observe();
  await contribution.proposeCode(addFile(observed.update, gadget.filesRoot, 'machine.txt', 'same held native draft'));
  // Original handshake is now expired, but the same capability and native provisional work live
  // under current finite checks. No reconnect, second account, workspace or proposal store.
  await new Promise(resolve => setTimeout(resolve, 2300));
  const status = await (await runtime.dispatchFetch('https://workshop.invalid/fixture-control?key=' + key)).json();
  assert.ok(status.checks >= 2);
  assert.equal(fileText((await contribution.observe()).update, gadget.filesRoot, 'machine.txt'), 'same held native draft');
  await contribution.finalizeDraft();
  const history = await workspace.getChatHistory(chat);
  const changes = history.messages.filter(message => message.type === 'changes');
  assert.deepEqual(changes.at(-1).author, {type: 'agent', ...author});
  assert.deepEqual(history.messages.find(message => message.type === 'message').author, await owner.account.whoami());
  await workspace.mergeChanges(chat, changes.at(-1).sequence);
  const accepted = await contribution.observe();
  assert.equal(accepted.workpieces.find(item => item.id === gadget.id)?.chatId, undefined);
  assert.equal(fileText(accepted.update, gadget.filesRoot, 'machine.txt'), 'same held native draft');
  await runtime.dispatchFetch('https://workshop.invalid/fixture-control?key=' + key + '&revoke=1');
  await eventuallyRejected(() => contribution.observe());
});

test('machine entry denies unshared, use-only and unrelated-chat authority before upgrade', {timeout: 30000}, async () => {
  const owner = await person(); const other = await person();
  const workspace = retain(await owner.account.newGadget());
  const id = (await workspace.getMetadata()).id;
  const chat = await workspace.newChat('Exact chat', null);
  assert.equal((await machineContribution(other, id, chat)).response.status, 403);
  await workspace.addCollaborator(other.name, 'use');
  assert.equal((await machineContribution(other, id, chat)).response.status, 403);
  assert.equal((await machineContribution(owner, id, 999999)).response.status, 403);
});

test('native sharing revocation closes the machine root although its host authority remains current', {timeout: 30000}, async () => {
  const owner = await person(); const other = await person();
  const workspace = retain(await owner.account.newGadget());
  const id = (await workspace.getMetadata()).id;
  const chat = await workspace.newChat('Shared machine chat', null);
  await workspace.addCollaborator(other.name, 'build');
  const machine = await machineContribution(other, id, chat);
  assert.equal(machine.response.status, 101);
  assert.equal((await machine.contribution.getInfo()).workspaceId, id);
  await workspace.removeCollaborator(other.name, []);
  await eventuallyRejected(() => machine.contribution.observe());
});


test('native composition saves fence slots, retain retry receipts and validate accepted proposals', {timeout: 30000}, async () => {
  const owner = await person();
  const workspace = retain(await owner.account.newGadget());
  const gadget = retain(await workspace.createGadget('Original canvas'));
  const gadgetId = await gadget.getId();
  const nativeSource = new Y.Doc();
  const files = nativeSource.getMap(String(gadgetId));
  files.set('server.js', new Y.Text(`import {DurableObject} from 'cloudflare:workers';
    export class Gadget extends DurableObject { identity = crypto.randomUUID(); read() {return this.identity;} }`));
  files.set('client.js', new Y.Text('document.body.textContent = "Original native view"'));
  await workspace.updateCode(Y.encodeStateAsUpdateV2(nativeSource));
  nativeSource.destroy();
  const originalBundle = await gadget.getUiBundle();
  const originalFacet = retain(await gadget.connectToGadget(undefined, originalBundle.identity));
  const originalFacetId = await originalFacet.read();
  const creation = {operationId: crypto.randomUUID(), title: 'Preserved composition', slots: [
    {id: 'source-template', path: 'legion/state/template.json', serializerId: 'json/1', bytes: '{"original":"complete"}'},
  ]};
  const created = await workspace.createComposition(creation);
  assert.notEqual(created.gadgetId, gadgetId, 'Creation must not reuse an unrelated native application');
  assert.deepEqual(await workspace.createComposition(creation), created, 'Lost create response resolves the original native identity');
  const createdState = retain(await workspace.getComposition(created.gadgetId));
  assert.equal((await createdState.compositionProtocol()).writesEnabled, false);
  assert.equal((await createdState.readComposition()).slots[0].bytes, creation.slots[0].bytes);
  await assert.rejects(Promise.resolve(workspace.createComposition({...creation, title: 'Changed template'})), /reused/);
  const invalidCreation = {...creation, operationId: crypto.randomUUID()};
  await assert.rejects(Promise.resolve(workspace.createComposition({...invalidCreation, slots: [{...creation.slots[0], path: 'server.js'}]})), /Invalid native composition slot rule/);
  const recoveredCreation = await workspace.createComposition(invalidCreation);
  assert.notEqual(recoveredCreation.gadgetId, created.gadgetId, 'Failed creation rolls back its claimed binding and native receipt');
  assert.equal(await originalFacet.read(), originalFacetId, 'Creating a composition preserves existing running applications');
  const composition = retain(await workspace.initializeComposition(gadgetId, [
    {id: 'world', path: 'legion/state/world.json', serializerId: 'json/1', bytes: '{"nodes":[]}'},
    {id: 'decor', path: 'legion/state/decor.json', serializerId: 'json/1', bytes: null},
  ]));
  const protocol = await composition.compositionProtocol();
  assert.equal(protocol.writesEnabled, false, 'Registration is not activation');
  const initial = await composition.readComposition();
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const change = (state, id, bytes) => ({slotId: id, expected: state.slots.find(slot => slot.id === id).token,
    next: bytes === null ? null : {bytes, digest: digest(bytes)}});
  const request = {protocol: 2, operationId: crypto.randomUUID(), changes: [change(initial, 'world', '{"nodes":[1]}')]};
  await assert.rejects(Promise.resolve(composition.applyCompositionChanges(request)), /disabled/);
  await workspace.setCompositionWritesEnabled(gadgetId, protocol, true);
  const newSlot = {id: 'new-world', path: 'legion/state/new-world.json', serializerId: 'json/1', bytes: null};
  await workspace.registerCompositionSlots(gadgetId, [newSlot]);
  const extended = await composition.readComposition();
  assert.deepEqual(extended.slots.filter(slot => slot.id !== 'new-world'), initial.slots, 'Adding a world preserves existing content and CAS tokens');
  assert.equal(extended.slots.find(slot => slot.id === 'new-world').token.slotRevision, 0);
  await workspace.registerCompositionSlots(gadgetId, [newSlot]);
  assert.deepEqual(await composition.readComposition(), extended, 'Lost declaration response can be retried without changing state');
  await assert.rejects(Promise.resolve(workspace.registerCompositionSlots(gadgetId, [{...newSlot, path: 'legion/state/other.json'}])), /cannot be replaced/);
  await assert.rejects(Promise.resolve(workspace.registerCompositionSlots(gadgetId, [{...newSlot, id: 'alias'}])), /Invalid native composition slot rule/);
  assert.equal(await originalFacet.read(), originalFacetId, 'Slot declaration does not restart native applications');
  const committed = await composition.applyCompositionChanges(request);
  assert.equal(committed.state, 'committed');
  assert.deepEqual(await composition.applyCompositionChanges(request), committed);
  assert.deepEqual(await composition.readCompositionOperation(request.operationId), committed);
  await assert.rejects(Promise.resolve(composition.applyCompositionChanges({...request, changes: [change(initial, 'world', '{}')]})), /reused/);
  const conflict = await composition.applyCompositionChanges({...request, operationId: crypto.randomUUID()});
  assert.equal(conflict.state, 'rejected');
  const independent = await composition.applyCompositionChanges({protocol: 2, operationId: crypto.randomUUID(), changes: [change(initial, 'decor', '{"color":"red"}')]});
  assert.equal(independent.state, 'committed', 'Unchanged independent-slot token still works');
  const beforeInvalid = await composition.readComposition();
  const invalid = await composition.applyCompositionChanges({protocol: 2, operationId: crypto.randomUUID(), changes: [
    change(beforeInvalid, 'world', '{"nodes":[2]}'), change(beforeInvalid, 'decor', '{'),
  ]});
  assert.equal(invalid.state, 'rejected');
  assert.deepEqual(await composition.readComposition(), beforeInvalid, 'Atomic failed save rolls back source, guards and epoch');
  const deleted = await composition.applyCompositionChanges({protocol: 2, operationId: crypto.randomUUID(), changes: [change(beforeInvalid, 'decor', null)]});
  assert.equal(deleted.state, 'committed');
  const tombstoned = await composition.readComposition();
  assert.equal(tombstoned.slots.find(slot => slot.id === 'decor').bytes, null);
  assert.equal((await composition.applyCompositionChanges({protocol: 2, operationId: crypto.randomUUID(), changes: [change(initial, 'decor', '{}')]})).state, 'rejected');
  assert.equal((await composition.applyCompositionChanges({protocol: 2, operationId: crypto.randomUUID(), changes: [change(tombstoned, 'decor', '{}')]})).state, 'committed');

  const chat = await workspace.newChat('Native composition proposal', null);
  const agent = retain(await workspace.createContribution(chat, author));
  const observed = await agent.observe();
  const root = observed.workpieces.find(item => item.id === gadgetId).filesRoot;
  const doc = new Y.Doc();
  Y.applyUpdateV2(doc, observed.update);
  const before = Y.encodeStateVector(doc);
  doc.getMap(root).set('legion/state/world.json', new Y.Text('{"nodes":[3]}'));
  doc.getMap(root).set('legion/state/index.json', new Y.Text('{"forged":"index"}'));
  await agent.proposeCode(Y.encodeStateAsUpdateV2(doc, before));
  doc.destroy();
  await agent.finalizeDraft();
  const edits = (await workspace.getChatHistory(chat)).messages.filter(message => message.type === 'changes');
  await workspace.mergeChanges(chat, edits.at(-1).sequence);
  const merged = await composition.readComposition();
  assert.equal(merged.slots.find(slot => slot.id === 'world').bytes, '{"nodes":[3]}');
  const accepted = await agent.observe();
  const index = JSON.parse(fileText(accepted.update, root, 'legion/state/index.json'));
  assert.equal(index.forged, undefined);
  assert.equal(index.slots.find(slot => slot.id === 'world').token.digest, digest('{"nodes":[3]}'));
  assert.equal((await composition.applyCompositionChanges({protocol: 2, operationId: crypto.randomUUID(), changes: [change(beforeInvalid, 'world', '{}')]})).state, 'rejected');

  const failingChat = await workspace.newChat('Reject invalid managed proposal atomically', null);
  const failingAgent = retain(await workspace.createContribution(failingChat, author));
  const provisional = await failingAgent.createGadget('Must stay provisional', 'PROVISIONAL');
  const invalidObserved = await failingAgent.observe();
  await failingAgent.proposeCode(addFile(invalidObserved.update, root, 'legion/state/world.json', '{'));
  await failingAgent.finalizeDraft();
  const invalidEdits = (await workspace.getChatHistory(failingChat)).messages.filter(message => message.type === 'changes');
  const beforeFailedAcceptance = await composition.readComposition();
  await assert.rejects(Promise.resolve(workspace.mergeChanges(failingChat, invalidEdits.at(-1).sequence)), /Managed composition JSON/);
  const afterFailure = await failingAgent.observe();
  assert.equal(afterFailure.workpieces.find(item => item.id === provisional.id).chatId, failingChat, 'Failed acceptance cannot promote a gadget');
  assert.equal((await workspace.getChatHistory(failingChat)).messages.some(message => message.type === 'merge'), false);
  assert.deepEqual(await composition.readComposition(), beforeFailedAcceptance, 'Failed proposal preserves accepted source and guards');

  const currentBundle = await gadget.getUiBundle();
  assert.deepEqual(currentBundle.identity, originalBundle.identity, 'State saves/proposals preserve both native generations');
  assert.equal(await originalFacet.read(), originalFacetId, 'Real workerd facet survived all state saves and proposal acceptance');
  const connectedAgain = retain(await gadget.connectToGadget(undefined, currentBundle.identity));
  assert.equal(await connectedAgain.read(), originalFacetId);

  const executable = new Y.Doc(); Y.applyUpdateV2(executable, accepted.update);
  const beforeExecutable = Y.encodeStateVector(executable);
  executable.getMap(root).set('server.js', new Y.Text(`import {DurableObject} from 'cloudflare:workers';
    export class Gadget extends DurableObject { identity = crypto.randomUUID(); read() {return this.identity + '-new';} }`));
  await workspace.updateCode(Y.encodeStateAsUpdateV2(executable, beforeExecutable));
  executable.destroy();
  const changedBundle = await gadget.getUiBundle();
  assert.ok(changedBundle.identity.executionGeneration > currentBundle.identity.executionGeneration);
  assert.equal(changedBundle.identity.uiGeneration, currentBundle.identity.uiGeneration);
  await assert.rejects(Promise.resolve(gadget.connectToGadget(undefined, currentBundle.identity)), /EXECUTION_REFRESH_REQUIRED/);
  const newFacet = retain(await gadget.connectToGadget(undefined, changedBundle.identity));
  assert.notEqual(await newFacet.read(), originalFacetId);
  assert.match(await newFacet.read(), /-new$/);
  const reopened = retain(await workspace.getComposition(gadgetId));
  assert.deepEqual((await reopened.readComposition()).slots, merged.slots);
  await workspace.setCompositionWritesEnabled(gadgetId, protocol, false);
  await assert.rejects(Promise.resolve(reopened.applyCompositionChanges({protocol: 2, operationId: crypto.randomUUID(), changes: [change(merged, 'world', '{}')]})), /disabled/);
  assert.deepEqual(await reopened.readCompositionOperation(request.operationId), committed, 'Disabled writes still permit resolution of earlier effects');
  workspace[Symbol.dispose]();
  await eventuallyRejected(() => reopened.readComposition(), /access ended/);
});
