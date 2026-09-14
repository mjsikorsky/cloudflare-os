import {describe, expect, it, vi} from "vitest";
import {RpcStub, RpcTarget} from "capnweb";
import {fetchWithContribution} from "../src/server";

// These setup-race fixtures measure disposal at the real server/Cap'n Web boundary.
// Real User/Overseer persistence and sharing are tested by test:contribution separately.
const target = {workspaceId: "a".repeat(64), chatId: 1, author: {id: "dsh:session-1", name: "DSH"}};
function request(signal?: AbortSignal) {
  return new Request("https://host.example/api", {signal, headers: {Upgrade: "websocket", Origin: "https://host.example"}});
}
function identity(lifetime = 5000) {
  return {id: "person", name: "Person", expiresAt: Date.now() + lifetime, logoutUrl: "/sign-out"};
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  return {promise: new Promise<T>(r => {resolve = r;}), resolve};
}
function fixture() {
  const parentReleased = vi.fn();
  const childReleased = vi.fn();
  const authenticateExternal = vi.fn(async () => false);
  const opened = deferred<void>();
  const childStarted = deferred<void>();
  const parentGate = deferred<void>();
  const childGate = deferred<void>();
  class Child extends RpcTarget {
    getInfo() {return target;}
    [Symbol.dispose]() {childReleased();}
  }
  class Parent extends RpcTarget {
    async createContribution() {childStarted.resolve(); await childGate.promise; return new RpcStub(new Child());}
    [Symbol.dispose]() {parentReleased();}
  }
  const ctx = {waitUntil() {}, exports: {
    UserDurableObject: {idFromName: (id: string) => id, get: () => ({authenticateExternal,
      id: {name: "person", toString: () => "person-do"}})},
    OverseerDurableObject: {idFromString: (id: string) => id, get: () => ({async open() {
      opened.resolve(); await parentGate.promise; return new Parent();
    }})},
    AdminSettings: {getByName: () => ({ensureFormatBlueprintsInstalled: async () => true})},
  }} as unknown as ExecutionContext;
  const env = {BLUEPRINTS: {get: async () => null}} as unknown as Cloudflare.Env;
  return {ctx, env, parentReleased, childReleased, authenticateExternal, opened, childStarted, parentGate, childGate};
}

describe("narrow contribution setup cancellation", () => {
  it("does not authenticate an already-cancelled request or accept a non-exact entry path", async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort();
    const response = await fetchWithContribution(request(controller.signal), f.env, f.ctx, identity(), target);
    expect(response.status).toBe(403);
    expect(f.authenticateExternal).not.toHaveBeenCalled();
    const wrongPath = new Request("https://host.example/api/another", request());
    expect((await fetchWithContribution(wrongPath, f.env, f.ctx, identity(), target)).status).toBe(404);
  });

  it("disposes a parent returned after request cancellation without minting its child", async () => {
    const f = fixture(); const controller = new AbortController();
    const result = fetchWithContribution(request(controller.signal), f.env, f.ctx, identity(), target);
    await f.opened.promise;
    controller.abort(); f.parentGate.resolve();
    const response = await result;
    expect(response.status).toBe(403); expect(response.webSocket).toBeNull();
    expect(f.parentReleased).toHaveBeenCalledTimes(1);
    expect(f.childReleased).not.toHaveBeenCalled();
  });

  it("expiry releases its parent immediately and a child returned late before any upgrade", async () => {
    const f = fixture(); f.parentGate.resolve();
    const result = fetchWithContribution(request(), f.env, f.ctx, identity(150), target);
    await f.childStarted.promise;
    await vi.waitFor(() => expect(f.parentReleased).toHaveBeenCalledTimes(1), {timeout: 1000});
    f.childGate.resolve();
    const response = await result;
    expect(response.status).toBe(403); expect(response.webSocket).toBeNull();
    expect(f.parentReleased).toHaveBeenCalledTimes(1);
    expect(f.childReleased).toHaveBeenCalledTimes(1);
  });
});
