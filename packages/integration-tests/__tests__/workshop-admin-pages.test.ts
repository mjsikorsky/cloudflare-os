import { afterAll, beforeAll, expect, it } from "vitest";
import {
  ADMIN_USERNAME, startTestGatekeeperHarness, TEST_VENDOR_ID, type Harness,
} from "../src/harness.js";
import { scriptedModelRouter } from "../src/mock-model.js";
import { NetworkInterceptor } from "../src/network-interceptor.js";
import { connect, nextUsernames, signUp } from "../src/rpc-client.js";

// A gatekeeper vendor's /admin page (VendorDescription.providesAdmin), driven end to end through the
// admin API: only a deployment admin reaches it, the vendor sees who is acting, and an action's
// one-time secret comes back to the caller.

let harness: Harness;
const models = scriptedModelRouter();
const network = new NetworkInterceptor({ handlers: [models.handler] });

beforeAll(async () => {
  network.install();
  harness = await startTestGatekeeperHarness();
});

afterAll(async () => {
  try {
    await harness?.server.close();
    expect(network.getUnmockedCalls()).toEqual([]);
  } finally {
    network.uninstall();
  }
});

it("serves a vendor's admin page to a deployment admin and runs its actions", async () => {
  const [ordinaryName] = nextUsernames("ordinary");
  using ordinaryPublic = connect(harness.url);
  using ordinary = await signUp(ordinaryPublic, ordinaryName!);
  expect(await ordinary.getAdminApi()).toBeNull();

  using adminPublic = connect(harness.url);
  using adminApi = await signUp(adminPublic, ADMIN_USERNAME);
  using admin = await adminApi.getAdminApi();
  if (admin === null) throw new Error("The deployment admin API was unavailable");

  const page = (await admin.getVendorAdminPages()).find(candidate => candidate.vendorId === TEST_VENDOR_ID);
  expect(page).toMatchObject({ title: "Test admin", view: { sections: [{ id: "items", rows: [] }] } });
  expect(page!.view!.sections[0]!.emptyText).toContain(ADMIN_USERNAME);

  const added = await admin.runVendorAdminAction(TEST_VENDOR_ID, "add", { name: "alpha" });
  expect(added).toEqual({ message: "Added alpha.", secret: { label: "Key for alpha", value: "key-alpha" } });
  const after = (await admin.getVendorAdminPages()).find(candidate => candidate.vendorId === TEST_VENDOR_ID);
  expect(after!.view!.sections[0]!.rows).toEqual([
    expect.objectContaining({ id: "alpha", cells: ["alpha", ADMIN_USERNAME] }),
  ]);

  await admin.runVendorAdminAction(TEST_VENDOR_ID, "remove", { name: "alpha" });
  await expect(admin.runVendorAdminAction(TEST_VENDOR_ID, "explode", {})).rejects.toThrow(/Unknown admin action/);
  await expect(admin.runVendorAdminAction("no-such-vendor", "add", { name: "x" })).rejects.toThrow(/has no admin page/);
});
