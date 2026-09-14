import {describe, it, expect} from "vitest";
import {validateExternalIdentity, validateExternalVisitor} from "../src/auth/external";

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
