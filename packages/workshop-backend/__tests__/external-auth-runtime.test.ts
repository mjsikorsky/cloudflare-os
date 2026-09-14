import { describe, expect, it, vi } from "vitest";
import { newWebSocketRpcSession } from "capnweb";
import type { PublicApi } from "@gadgets/workshop-shared/api";
import nativeServer, { fetchWithIdentity } from "../src/server";

// Real workerd WebSocketPair and Cap'n Web serialization; only the account/config
// persistence boundary is a fixture. This does not prove Clerk or UserDO tenancy.
function fixture() {
  const profile = {type: "user" as const, id: "host-person-1", name: "Person"};
  const whoami = vi.fn(async () => profile);
  const authenticateExternal = vi.fn(async () => false);
  const user = {authenticateExternal, whoami};
  const ctx = {
    exports: {
      UserDurableObject: {idFromName: (id: string) => id, get: () => user},
      OverseerDurableObject: {},
      AdminSettings: {getByName: () => ({ensureFormatBlueprintsInstalled: async () => true})},
    },
    waitUntil: (_promise: Promise<unknown>) => {},
  } as unknown as ExecutionContext;
  const env = {BLUEPRINTS: {get: async () => null}} as unknown as Cloudflare.Env;
  return {ctx, env, whoami, authenticateExternal};
}
function request(method = "GET", origin = "https://host.example") {
  return new Request("https://host.example/api", {method,
    headers: {Origin: origin, ...(method === "GET" ? {Upgrade: "websocket"} : {})}});
}
function admission(lifetime = 1000) {
  return {id: "host-person-1", name: "Person", expiresAt: Date.now() + lifetime,
    logoutUrl: "/sign-out"};
}
function closed(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Host admission did not close its transport")), 5000);
    socket.addEventListener("close", () => {clearTimeout(timer); resolve();}, {once: true});
  });
}

// Send adversarial calls on the native wire and inspect rejection frames directly.
// Successful authentication and retained-capability expiry below use the real RPC client.
function rejectedCall(socket: WebSocket, method: string, args: unknown[]) {
  return new Promise<unknown[]>((resolve, reject) => {
    const timer = setTimeout(() => {socket.removeEventListener("message", receive); reject(new Error("Missing RPC rejection"));}, 2000);
    function receive(event: MessageEvent) {
      clearTimeout(timer);
      socket.removeEventListener("message", receive);
      resolve(JSON.parse(event.data as string) as unknown[]);
    }
    socket.addEventListener("message", receive);
    socket.send(JSON.stringify(["stream", ["pipeline", 0, [method], args]]));
  });
}

describe("host admission on native workerd RPC transport", () => {
  it("refuses already-cancelled host authority before allocating a native transport", async () => {
    const f = fixture();
    const owner = new AbortController();
    owner.abort();
    const revalidate = vi.fn(async () => undefined);
    const response = await fetchWithIdentity(request(), f.env, f.ctx, admission(), {
      scope: "execution:person-1/workspace-a/session-1", signal: owner.signal, revalidate,
    });
    expect(response.status).toBe(403);
    expect(response.webSocket).toBeNull();
    expect(f.authenticateExternal).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("preserves the same held native RPC capability through finite renewals, then revokes it", async () => {
    const f = fixture();
    const owner = new AbortController();
    let checks = 0;
    const response = await fetchWithIdentity(request(), f.env, f.ctx, admission(400), {
      scope: "execution:person-1/workspace-a/session-1", signal: owner.signal,
      async revalidate(original, signal) {
        signal.throwIfAborted();
        checks++;
        return {identity: {...original, expiresAt: Date.now() + 400},
          scope: "execution:person-1/workspace-a/session-1"};
      },
    });
    const socket = response.webSocket!;
    socket.accept();
    const ended = closed(socket);
    using api = newWebSocketRpcSession<PublicApi>(socket);
    using authenticated = await api.authenticateExternal();
    expect((await authenticated.whoami()).id).toBe("host-person-1");
    await new Promise(resolve => setTimeout(resolve, 950));
    expect(checks).toBeGreaterThanOrEqual(3);
    expect((await authenticated.whoami()).id).toBe("host-person-1");
    expect(f.authenticateExternal).toHaveBeenCalledTimes(1);
    owner.abort();
    await ended;
    await expect(Promise.resolve(authenticated.whoami())).rejects.toThrow();
    expect(f.whoami).toHaveBeenCalledTimes(2);
  });

  it("a hung host renewal cannot retain an issued native capability beyond the old deadline", async () => {
    const f = fixture();
    const owner = new AbortController();
    let pendingSignal: AbortSignal | undefined;
    let release!: (value: undefined) => void;
    const response = await fetchWithIdentity(request(), f.env, f.ctx, admission(400), {
      scope: "execution:person-1/workspace-a/session-1", signal: owner.signal,
      revalidate(_identity, signal) {
        pendingSignal = signal;
        return new Promise(resolve => {release = resolve;});
      },
    });
    const socket = response.webSocket!;
    socket.accept();
    const ended = closed(socket);
    using api = newWebSocketRpcSession<PublicApi>(socket);
    using authenticated = await api.authenticateExternal();
    expect((await authenticated.whoami()).id).toBe("host-person-1");
    await ended;
    expect(pendingSignal?.aborted).toBe(true);
    release(undefined);
    await expect(Promise.resolve(authenticated.whoami())).rejects.toThrow();
  });

  it("revokes an already-issued authenticated capability at expiry", async () => {
    const f = fixture();
    const response = await fetchWithIdentity(request(), f.env, f.ctx, admission());
    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    socket.accept();
    const ended = closed(socket);
    using api = newWebSocketRpcSession<PublicApi>(socket);
    using authenticated = await api.authenticateExternal();
    expect(await authenticated.whoami()).toEqual({type: "user", id: "host-person-1", name: "Person"});
    await ended;
    await expect(Promise.resolve(authenticated.whoami())).rejects.toThrow();
    expect(f.whoami).toHaveBeenCalledTimes(1);
  });

  it("does not finish delayed account admission after its transport expires", async () => {
    const f = fixture();
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => {started = resolve;});
    const gate = new Promise<void>(resolve => {release = resolve;});
    f.authenticateExternal.mockImplementation(async () => {started(); await gate; return false;});
    const response = await fetchWithIdentity(request(), f.env, f.ctx, admission());
    const socket = response.webSocket!;
    socket.accept();
    const ended = closed(socket);
    using api = newWebSocketRpcSession<PublicApi>(socket);
    // Attach the rejection consumer before expiry; a transport failure is the expected outcome.
    const result = Promise.resolve(api.authenticateExternal()).then(
      value => {value[Symbol.dispose](); return "admitted";},
      () => "refused",
    );
    try {
      await entered;
      await ended;
    } finally {release();}
    expect(await result).toBe("refused");
    expect(f.whoami).not.toHaveBeenCalled();
  });

  it("cannot use another native sign-in method on a host-admitted connection", async () => {
    const f = fixture();
    const response = await fetchWithIdentity(request(), f.env, f.ctx, admission(5000));
    const socket = response.webSocket!;
    socket.accept();
    try {
      const calls: [string, unknown[]][] = [
        ["authenticate", ["someone:token"]],
        ["authenticateFromCfAccess", []],
        ["login", ["someone", ["bytes", ""]]],
        ["createAccount", ["someone", "Someone", ["bytes", ""]]],
        ["startGatekeeperLogin", ["google"]],
      ];
      for (const [method, args] of calls) {
        const frame = await rejectedCall(socket, method, args);
        expect(frame[0]).toBe("reject");
        expect(frame[2]).toEqual(["error", "Error", "This connection uses host authentication."]);
      }
      expect(f.authenticateExternal).not.toHaveBeenCalled();
    } finally {socket.close();}
  });

  it("refuses HTTP batches and cross-origin upgrades before account admission", async () => {
    const f = fixture();
    expect((await fetchWithIdentity(request("POST"), f.env, f.ctx, admission())).status).toBe(426);
    expect((await fetchWithIdentity(request("GET", "https://attacker.example"), f.env, f.ctx, admission())).status).toBe(403);
    expect(f.authenticateExternal).not.toHaveBeenCalled();
  });

  it("refuses an already-expired admission before opening a transport", async () => {
    const f = fixture();
    await expect(fetchWithIdentity(request(), f.env, f.ctx, admission(-1))).rejects.toThrow("Invalid external identity");
    expect(f.authenticateExternal).not.toHaveBeenCalled();
  });

  it("does not treat identity headers as admission on the default native entry", async () => {
    const f = fixture();
    const req = request();
    req.headers.set("X-Legion-Workshop-Identity", JSON.stringify(admission()));
    const response = await nativeServer.fetch(req, f.env, f.ctx);
    const socket = response.webSocket!;
    socket.accept();
    try {
      const frame = await rejectedCall(socket, "authenticateExternal", []);
      expect(frame[0]).toBe("reject");
      expect(frame[2]).toEqual(["error", "Error", "No current external identity admission."]);
      expect(f.authenticateExternal).not.toHaveBeenCalled();
    } finally {socket.close();}
  });
});
