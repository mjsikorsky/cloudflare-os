// submitAction refusals: a push under the restricted-data latch, and any action on a removed
// connection.
// Runs against a real OverseerDurableObject (the TEST_OVERSEER binding); records are seeded
// directly through the impl.

import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { OverseerDurableObject } from "../src/overseer.js";
import type { ActionDescription } from "@gadgets/workshop-shared/gatekeeper";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
  }
}

const CALLER = { from: "user" } as const;

function getImpl(instance: OverseerDurableObject): any {
  return (instance as unknown as { impl: any }).impl;
}

function seedGatekeeper(impl: any, id: number): void {
  impl.storage.gatekeepers.put({
    id,
    resourceTitle: `Connection ${id}`,
    class: {} as any,
    creationSpec: {
      type: "gatekeeper",
      vendorId: "testvendor",
      resourceUrl: `https://example.com/${id}`,
      typeUrlPattern: "https://*",
    },
  });
}

// A restricted observation attributed to `gatekeeperId` plus the latch, as authorizeObservation
// writes them.
function seedRestrictedObservation(impl: any, gatekeeperId: number, actionId: number): void {
  impl.storage.actions.put({
    id: actionId,
    gatekeeperId,
    caller: CALLER,
    createdAt: new Date(),
    state: "approved",
    type: "observation",
    description: {
      title: "Read a thing",
      description: "The test read a thing.",
      containsRestrictedData: true,
    },
  });
  impl.storage.nextActionId.put(actionId + 1);
  impl.storage.containsRestrictedData.put(true);
}

const POKE: ActionDescription = {
  title: "Poke the thing",
  description: "The test poked the thing.",
  // What a real gatekeeper asserts when its text shows everything the action will send.
  descriptionIsComplete: true,
  implementsRevert: false,
  actionKind: { tag: "poke", label: "Pokes" },
};

function actionStates(impl: any): Array<{ gatekeeperId: number; state: string }> {
  return [...impl.storage.actions.list()]
      .filter((rec: any) => rec.type === "action")
      .map((rec: any) => ({ gatekeeperId: rec.gatekeeperId, state: rec.state }));
}

describe("submitAction refusals", () => {
  it("refuses a push while restricted, even one claiming a complete description", async () => {
    let stub = env.TEST_OVERSEER.getByName("restricted-actions-push");
    await runInDurableObject(stub, async (instance: OverseerDurableObject) => {
      let impl = getImpl(instance);
      seedGatekeeper(impl, 1);
      seedRestrictedObservation(impl, 1, 100);

      // Commits cannot be reviewed as text, so the claim does not count. Refused before push
      // ancestry is even checked, which is why an unproven head is fine here.
      await expect(impl.submitAction(1, 0, {
        ...POKE,
        pushedCommits: ["0123456789abcdef0123456789abcdef01234567"],
      }, CALLER)).rejects.toThrow(/git push cannot be reviewed as of yet/i);
      expect(actionStates(impl)).toEqual([]);
    });
  });

  it("refuses an action on a removed connection, writing no record", async () => {
    let stub = env.TEST_OVERSEER.getByName("restricted-actions-removed");
    await runInDurableObject(stub, async (instance: OverseerDurableObject) => {
      let impl = getImpl(instance);
      seedGatekeeper(impl, 1);
      impl.storage.gatekeepers.delete(1);
      let nextActionId = impl.storage.nextActionId.get();

      await expect(impl.submitAction(1, 0, POKE, CALLER))
          .rejects.toThrow(/has been removed from this workspace/i);
      expect(actionStates(impl)).toEqual([]);
      expect(impl.storage.nextActionId.get()).toBe(nextActionId);
    });
  });
});

const AUDIENCE = { scheme: "acme.realm", id: "org_1", label: "Acme's shared layer" };
const ENABLER = { type: "user", id: "enabler@example.com", name: "Enabler" } as const;
const RESTRICTED_READ = { title: "Read a feed", description: "The test read restricted data.", containsRestrictedData: true };

describe("audience-scoped actions in a restricted workspace", () => {
  it("records each gatekeeper whose observation set the latch, once", async () => {
    let stub = env.TEST_OVERSEER.getByName("restricted-producers");
    await runInDurableObject(stub, async (instance: OverseerDurableObject) => {
      let impl = getImpl(instance);
      seedGatekeeper(impl, 1);
      seedGatekeeper(impl, 2);
      expect(impl.storage.restrictedProducers.get()).toBeNull();
      await impl.authorizeObservation(1, RESTRICTED_READ, CALLER);
      await impl.authorizeObservation(2, RESTRICTED_READ, CALLER);
      await impl.authorizeObservation(1, RESTRICTED_READ, CALLER);
      await impl.authorizeObservation(2, { title: "Read", description: "Nothing restricted." }, CALLER);
      expect(impl.storage.containsRestrictedData.get()).toBe(true);
      expect(impl.storage.restrictedProducers.get()).toEqual([1, 2]);
    });
  });

  it("keeps a workspace latched before producers were recorded fully manual", async () => {
    let stub = env.TEST_OVERSEER.getByName("restricted-producers-legacy");
    await runInDurableObject(stub, async (instance: OverseerDurableObject) => {
      let impl = getImpl(instance);
      seedGatekeeper(impl, 1);
      seedRestrictedObservation(impl, 1, 100);  // the latch alone, as an older workspace has it
      await impl.authorizeObservation(1, RESTRICTED_READ, CALLER);
      expect(impl.storage.restrictedProducers.get()).toBeNull();
    });
  });

  it("auto-applies an action whose audience every producer admits, and pends one it does not", async () => {
    let stub = env.TEST_OVERSEER.getByName("restricted-audience");
    await runInDurableObject(stub, async (instance: OverseerDurableObject) => {
      let impl = getImpl(instance);
      seedGatekeeper(impl, 1);  // the restricted producer (a feed)
      seedGatekeeper(impl, 2);  // the acting gatekeeper (a publish)
      let applied: number[] = [];
      let asked: unknown[] = [];
      impl.getGatekeeperFacet = (id: number) => id === 1
        ? { admitsAudience: async (audience: { id: string }) => { asked.push(audience); return audience.id === "org_1"; } }
        : { applyAction: async (action: number) => { applied.push(action); } };
      await impl.authorizeObservation(1, RESTRICTED_READ, CALLER);
      impl.storage.autoApproveTags.put({ gatekeeperId: 2, actionKind: POKE.actionKind, enabledBy: ENABLER });

      await impl.submitAction(2, 10, { ...POKE, autoApprovable: true, audience: AUDIENCE }, CALLER);
      // submitAction started the drain in the background (it asks the producer first).
      await vi.waitFor(() => expect(applied).toEqual([10]));
      let admitted = [...impl.storage.actions.list()].find((rec: any) => rec.type === "action" && rec.action === 10);
      expect(admitted).toMatchObject({ state: "approved", autoApproved: true, audienceAdmittedBy: [1] });
      expect(applied).toEqual([10]);
      expect(asked).toContainEqual(AUDIENCE);

      // Another realm's audience: the producer refuses, so a person decides.
      await impl.submitAction(2, 11, { ...POKE, autoApprovable: true, audience: { ...AUDIENCE, id: "org_2" } }, CALLER);
      // No audience at all: never asked, still manual.
      await impl.submitAction(2, 12, { ...POKE, autoApprovable: true }, CALLER);
      await impl.drainAutoApprovals(2);
      let states = [...impl.storage.actions.list()].filter((rec: any) => rec.type === "action")
          .map((rec: any) => [rec.action, rec.state]);
      expect(states).toEqual([[10, "approved"], [11, "pending"], [12, "pending"]]);
      expect(applied).toEqual([10]);
    });
  });
});
