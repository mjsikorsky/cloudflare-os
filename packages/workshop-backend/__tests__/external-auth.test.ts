import {describe, it, expect} from "vitest";
import {validateExternalIdentity, validateExternalVisitor, VERIFIER_ADMISSION_MAX_MS} from "../src/auth/external";

const now = 1000;
const admission = {id: "host-person-1", name: "Person", expiresAt: now + 60_000,
  logoutUrl: "/sign-out"};
describe("host identity admission", () => {
  it("snapshots a stable principal without retaining the mutable caller object", () => {
    const input = {...admission};
    const result = validateExternalIdentity(input, "https://host.example/workshop/api", now);
    input.id = "another-person";
    expect(result.id).toBe(admission.id);
    expect(Object.isFrozen(result)).toBe(true);
  });
  it.each([now, now - 1, now + 300_001, NaN, Infinity])("rejects invalid lifetime %s", expiresAt => {
    expect(() => validateExternalIdentity({...admission, expiresAt}, "https://host.example", now)).toThrow();
  });
  it.each(["//attacker.example", "https://attacker.example/", "javascript:alert(1)",
    "https://user:password@host.example/"])("refuses unsafe logout %s", logoutUrl => {
    expect(() => validateExternalIdentity({...admission, logoutUrl}, "https://host.example", now)).toThrow();
  });
  it.each([undefined, null, 123, {}, ""])("rejects nonstring or empty identities %s", id => {
    expect(() => validateExternalIdentity({...admission, id} as never, "https://host.example", now)).toThrow();
  });
  it.each([undefined, null, 123, {}, ""])("rejects missing or nonstring logout %s", logoutUrl => {
    expect(() => validateExternalIdentity({...admission, logoutUrl} as never, "https://host.example", now)).toThrow();
  });
  it("retains an explicit host sign-out path", () => {
    expect(validateExternalIdentity({...admission, logoutUrl: "/sign-out?from=workshop"},
      "https://host.example/workshop/api", now).logoutUrl).toBe("/sign-out?from=workshop");
  });
  it("carries the host's guest-link API and page only when offered, as host-origin paths", () => {
    expect("guestLinks" in validateExternalIdentity(admission, "https://host.example/api", now)).toBe(false);
    const result = validateExternalIdentity({...admission, guestLinks: {api: "/legion/api/guest-links", page: "https://host.example/guest-links?x=1"}},
      "https://host.example/workshop/api", now);
    expect(result.guestLinks).toEqual({api: "/legion/api/guest-links", page: "/guest-links?x=1"});
    expect(Object.isFrozen(result.guestLinks)).toBe(true);
  });
  it.each(["//attacker.example/guest-links", "https://attacker.example/guest-links", "javascript:alert(1)",
    "https://user:password@host.example/guest-links", "", null, 123, {}])("refuses an unsafe guest-link path %s", bad => {
    expect(() => validateExternalIdentity({...admission, guestLinks: {api: bad, page: "/guest-links"}} as never, "https://host.example", now)).toThrow();
    expect(() => validateExternalIdentity({...admission, guestLinks: {api: "/legion/api/guest-links", page: bad}} as never, "https://host.example", now)).toThrow();
  });
  it.each([null, "x", 1, {}, {api: "/a"}, {page: "/p"}])("refuses a malformed guest-link host %s", guestLinks => {
    expect(() => validateExternalIdentity({...admission, guestLinks} as never, "https://host.example", now)).toThrow();
  });
});

const visitor = {loginUrl: "/login", logoutUrl: "/sign-out"};
describe("host visitor admission", () => {
  it("keeps both host pages as paths on the host origin", () => {
    const result = validateExternalVisitor({loginUrl: "https://host.example/login?from=workshop",
      logoutUrl: "/sign-out"}, "https://host.example/workshop/api");
    expect(result).toEqual({loginUrl: "/login?from=workshop", logoutUrl: "/sign-out"});
    expect(Object.isFrozen(result)).toBe(true);
  });
  it.each(["//attacker.example", "https://attacker.example/login", "javascript:alert(1)",
    "https://user:password@host.example/login"])("refuses unsafe sign-in %s", loginUrl => {
    expect(() => validateExternalVisitor({...visitor, loginUrl}, "https://host.example")).toThrow("host origin");
  });
  it.each([undefined, null, 123, {}, ""])("rejects missing or nonstring sign-in %s", loginUrl => {
    expect(() => validateExternalVisitor({...visitor, loginUrl} as never, "https://host.example")).toThrow();
  });
  it.each([undefined, null, 123, {}, "", "https://attacker.example/"])("rejects invalid sign-out %s", logoutUrl => {
    expect(() => validateExternalVisitor({...visitor, logoutUrl} as never, "https://host.example")).toThrow();
  });
  it.each([undefined, null, "visitor"])("rejects a non-object admission %s", value => {
    expect(() => validateExternalVisitor(value as never, "https://host.example")).toThrow();
  });
});

import {isVerifierIdentityId, validateExternalVerifierTarget} from "../src/auth/external-verifier";

const gadgetId = "a".repeat(64);
describe("host verifier target", () => {
  it("snapshots the exact workspace and grant", () => {
    const input = {gadgetId, shareKey: "0f1e"};
    const result = validateExternalVerifierTarget(input);
    (input as {gadgetId: string}).gadgetId = "b".repeat(64);
    expect(result).toEqual({gadgetId, shareKey: "0f1e"});
    expect(Object.isFrozen(result)).toBe(true);
    expect(validateExternalVerifierTarget({gadgetId})).toEqual({gadgetId});
  });
  it.each([undefined, null, 123, "", "abc", "A".repeat(64), gadgetId + "0"])("rejects workspace %s", value => {
    expect(() => validateExternalVerifierTarget({gadgetId: value} as never)).toThrow("Invalid external verifier target.");
  });
  it.each([null, 123, "", "z", "0", "0".repeat(513)])("rejects grant %s", shareKey => {
    expect(() => validateExternalVerifierTarget({gadgetId, shareKey} as never)).toThrow("Invalid external verifier target.");
  });
  it("recognizes only the verifier identity namespace", () => {
    expect(isVerifierIdentityId("openv-abc")).toBe(true);
    expect(isVerifierIdentityId("host-person-1")).toBe(false);
    expect(isVerifierIdentityId("legion-openv-abc")).toBe(false);
    expect(isVerifierIdentityId(undefined)).toBe(false);
  });
});

describe("host admission lifetime", () => {
  it("caps a person's admission at five minutes and a verifier's at the grant's life", () => {
    const week = now + VERIFIER_ADMISSION_MAX_MS;
    expect(() => validateExternalIdentity({...admission, expiresAt: now + 300_001}, "https://host.example", now)).toThrow();
    expect(validateExternalIdentity({...admission, expiresAt: week}, "https://host.example", now, VERIFIER_ADMISSION_MAX_MS).expiresAt).toBe(week);
    expect(() => validateExternalIdentity({...admission, expiresAt: week + 1}, "https://host.example", now, VERIFIER_ADMISSION_MAX_MS)).toThrow();
    expect(VERIFIER_ADMISSION_MAX_MS).toBeLessThan(2 ** 31);
  });
});
