import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { ConnectionDurableObject } from "../src/server";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_CONNECTION: DurableObjectNamespace<ConnectionDurableObject>;
  }
}

// The connection object is the request handler run inside a Durable Object: its state stands in
// for the Worker context (HostContext). Admission is the deploying host's job, applied to this
// object's fetch as to the default export, so the object itself admits nobody and knows no caller.
describe("connection durable object", () => {
  it("serves the request handler from inside a durable object", async () => {
    const stub = env.TEST_CONNECTION.get(env.TEST_CONNECTION.newUniqueId());
    await runInDurableObject(stub, async (instance: ConnectionDurableObject, state) => {
      expect(instance).toBeInstanceOf(ConnectionDurableObject);
      expect(typeof state.exports).toBe("object");
      expect(typeof state.waitUntil).toBe("function");
      // Routed by the same handler as the Worker: an unknown path is the handler's own 404.
      const response = await instance.fetch(new Request("https://host.example/nowhere"));
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not Found");
    });
  });
});
