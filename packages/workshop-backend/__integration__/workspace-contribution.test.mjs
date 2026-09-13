import { before, after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
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
  runtime = new Miniflare({modulesRoot, modules,
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    durableObjects: Object.fromEntries(config.migrations.flatMap(migration => migration.new_sqlite_classes ?? [])
      .map(className => [className, {className, useSQLite: true}])),
    kvNamespaces: ['BLUEPRINTS', 'AVATARS'], r2Buckets: ['BLUEPRINT_CONTENT'],
    bindings: {PUBLIC_BASE_URL: 'https://workshop.invalid'},
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
