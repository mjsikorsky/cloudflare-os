import { describe, expect, it, vi } from "vitest";
import { newWebSocketRpcSession, RpcTarget } from "capnweb";
import type { PublicApi } from "@gadgets/workshop-shared/api";
import nativeServer, { fetchWithIdentity, fetchAsVisitor, fetchWithContribution, fetchAsVerifier } from "../src/server";

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
function rejectedCall(socket: WebSocket, method: string, args: unknown[], target = 0) {
  return new Promise<unknown[]>((resolve, reject) => {
    const timer = setTimeout(() => {socket.removeEventListener("message", receive); reject(new Error("Missing RPC rejection"));}, 2000);
    function receive(event: MessageEvent) {
      clearTimeout(timer);
      socket.removeEventListener("message", receive);
      resolve(JSON.parse(event.data as string) as unknown[]);
    }
    socket.addEventListener("message", receive);
    socket.send(JSON.stringify(["stream", ["pipeline", target, [method], args]]));
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

  it("admits a host visitor to the public surface only and sends sign-in to the host", async () => {
    const f = fixture();
    const visitor = {loginUrl: "/login", logoutUrl: "/sign-out"};
    expect((await fetchAsVisitor(request("POST"), f.env, f.ctx, visitor)).status).toBe(426);
    expect((await fetchAsVisitor(request("GET", "https://attacker.example"), f.env, f.ctx, visitor)).status).toBe(403);
    await expect(fetchAsVisitor(request(), f.env, f.ctx, {...visitor, loginUrl: "https://attacker.example/login"}))
        .rejects.toThrow("host origin");
    const response = await fetchAsVisitor(request(), f.env, f.ctx, visitor);
    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    socket.accept();
    try {
      using api = newWebSocketRpcSession<PublicApi>(socket);
      const config = await api.getServerConfig();
      expect(config.externalAuthentication).toEqual({logoutUrl: "/sign-out", loginUrl: "/login"});
      expect(config.passwordAuthEnabled).toBe(false);
      expect(config.authVendors).toEqual([]);
      expect(await api.getBlueprint("missing")).toBeNull();
    } finally {socket.close();}
    // Every native sign-in method is refused; inspect the rejection frames on the wire.
    const raw = (await fetchAsVisitor(request(), f.env, f.ctx, visitor)).webSocket!;
    raw.accept();
    try {
      for (const [method, args, message] of [
        ["authenticateExternal", [], "Sign in through the host to continue."],
        ["authenticate", ["host-person-1:token"], "This connection uses host authentication."],
        ["startGatekeeperLogin", ["github"], "This connection uses host authentication."],
      ] as const) {
        const frame = await rejectedCall(raw, method, [...args]);
        expect(frame[0]).toBe("reject");
        expect(frame[2]).toEqual(["error", "Error", message]);
      }
      expect(f.authenticateExternal).not.toHaveBeenCalled();
    } finally {raw.close();}
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

  // ---- verifier seats (Open-V) ----

  const gadgetId = "c".repeat(64);
  function verifierFixture(role: "use" | "build" = "use") {
    const f = fixture();
    const profile = {type: "user" as const, id: "openv-verifier-1", name: "friend@example.com"};
    const created = vi.fn(async (_id: string, _name: string, allowCreate: boolean) => allowCreate);
    const user = {authenticateExternal: created, whoami: async () => profile,
      id: {toString: () => "openv-verifier-1", name: "openv-verifier-1"},
      forgetSharedGadget: async () => {}};
    class FakeOverseer extends RpcTarget {
      async getMetadata() {
        return {id: gadgetId, title: "Tic Tac Toe", role, owner: profile, defaultGadgetId: 0};
      }
      [Symbol.dispose]() {}
    }
    const open = vi.fn(async () => new FakeOverseer());
    (f.ctx as unknown as {exports: Record<string, unknown>}).exports.UserDurableObject =
        {idFromName: (id: string) => id, get: () => user};
    (f.ctx as unknown as {exports: Record<string, unknown>}).exports.OverseerDurableObject =
        {idFromString: (id: string) => id, get: () => ({open})};
    return {...f, created, open};
  }
  function verifier(lifetime = 1000) {
    return {id: "openv-verifier-1", name: "friend@example.com", expiresAt: Date.now() + lifetime,
      logoutUrl: "/sign-out"};
  }

  it("admits a host verifier to one pre-opened use seat and nothing else", async () => {
    const f = verifierFixture();
    const response = await fetchAsVerifier(request(), f.env, f.ctx, verifier(), {gadgetId, shareKey: "0f1e"});
    expect(response.status).toBe(101);
    // The account was created regardless of sign-up policy, and native openGadget redeemed the
    // grant once to validate the seat before any transport existed.
    expect(f.created).toHaveBeenCalledWith("openv-verifier-1", "friend@example.com", true);
    expect(f.open).toHaveBeenCalledTimes(1);
    expect(f.open.mock.calls[0][0]).toBe("openv-verifier-1");
    expect(f.open.mock.calls[0][3]).toBe("0f1e");
    const socket = response.webSocket!;
    socket.accept();
    try {
      using api = newWebSocketRpcSession<PublicApi>(socket);
      const config = await api.getServerConfig();
      expect(config.externalAuthentication).toEqual({logoutUrl: "/sign-out"});
      expect(config.passwordAuthEnabled).toBe(false);
      using account = await api.authenticateExternal();
      expect((await account.whoami()).id).toBe("openv-verifier-1");
      expect(await account.amIAdmin()).toBe(false);
      expect(await account.isOnboardingCompleted()).toBe(true);
      // Each client open is a native open with the host's grant, never the client's arguments.
      using seat = await account.openGadget(gadgetId, "client-supplied-key");
      expect((await seat.getMetadata()).role).toBe("use");
      expect(f.open).toHaveBeenCalledTimes(2);
      expect(f.open.mock.calls[1][3]).toBe("0f1e");
    } finally {socket.close();}
    // Refusals on the account capability: inspect the rejection frames on the wire (as the visitor
    // test does for the root), so no pipelined client promise is left dangling.
    const raw = (await fetchAsVerifier(request(), f.env, f.ctx, verifier(), {gadgetId, shareKey: "0f1e"})).webSocket!;
    raw.accept();
    try {
      // Export 1 = the verifier account.
      raw.send(JSON.stringify(["push", ["pipeline", 0, ["authenticateExternal"], []]]));
      const before = f.open.mock.calls.length;
      // Only the admitted workspace opens.
      let frame = await rejectedCall(raw, "openGadget", ["d".repeat(64)], 1);
      expect(frame[0]).toBe("reject");
      expect(String(frame[2])).toContain("access to this workspace");
      expect(f.open).toHaveBeenCalledTimes(before);
      // Everything else on the account surface is denied.
      for (const method of ["newGadget", "listGadgets", "listOwnBlueprints", "listOutputs", "getAdminApi"]) {
        frame = await rejectedCall(raw, method, [], 1);
        expect(frame[0]).toBe("reject");
        expect(String(frame[2])).toContain("Unauthorized");
      }
    } finally {raw.close();}
  });

  it("refuses a verifier seat that would hold more than the use role", async () => {
    const f = verifierFixture("build");
    const response = await fetchAsVerifier(request(), f.env, f.ctx, verifier(), {gadgetId});
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("External verifier access denied.");
  });

  it("keeps the verifier namespace out of every account entry", async () => {
    const f = verifierFixture();
    await expect(fetchWithIdentity(request(), f.env, f.ctx, verifier())).rejects.toThrow("cannot hold an account");
    await expect(fetchWithContribution(request(), f.env, f.ctx, verifier(),
        {workspaceId: gadgetId, chatId: 0, author: {id: "a", name: "a"}})).rejects.toThrow("cannot hold an account");
    await expect(fetchAsVerifier(request(), f.env, f.ctx, admission(), {gadgetId})).rejects.toThrow("verifier identity is required");
    expect((await fetchAsVerifier(request("POST"), f.env, f.ctx, verifier(), {gadgetId})).status).toBe(404);
    expect(f.created).not.toHaveBeenCalled();
    expect(f.open).not.toHaveBeenCalled();
  });

  it("refuses a native sign-in on a verifier connection", async () => {
    const f = verifierFixture();
    const raw = (await fetchAsVerifier(request(), f.env, f.ctx, verifier(), {gadgetId})).webSocket!;
    raw.accept();
    try {
      for (const method of ["authenticate", "startGatekeeperLogin", "authenticateFromCfAccess"]) {
        const frame = await rejectedCall(raw, method, ["x"]);
        expect(frame[0]).toBe("reject");
      }
    } finally {raw.close();}
  });
});
