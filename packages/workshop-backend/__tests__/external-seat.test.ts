import {afterEach, describe, expect, it, vi} from "vitest";
import {ExternalAdmissionSeat, type ExternalConnectionAuthority} from "../src/auth/external-seat";

const origin = "https://host.example/api";
const scope = "person:one/org:a/workspace:b/session:generation-1";
const identity = (expiresAt = Date.now() + 100) =>
  ({id: "person-one", name: "Person", logoutUrl: "/sign-out", expiresAt});
afterEach(() => {vi.useRealTimers();});
function fixture(revalidate: ExternalConnectionAuthority["revalidate"]) {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  const stop = new AbortController();
  const closed = vi.fn();
  const seat = new ExternalAdmissionSeat(identity(), origin, closed,
    {scope, signal: stop.signal, revalidate});
  return {seat, closed, stop};
}
describe("native external admission seat", () => {
  it("renews finite admission in place and cancels on authority revocation", async () => {
    const check = vi.fn(async (_identity: Readonly<ReturnType<typeof identity>>, _signal: AbortSignal) => ({identity: identity(), scope}));
    const f = fixture(check);
    await vi.advanceTimersByTimeAsync(275);
    expect(check).toHaveBeenCalledTimes(5);
    expect(f.seat.current().id).toBe("person-one");
    expect(f.closed).not.toHaveBeenCalled();
    f.stop.abort();
    expect(f.closed).toHaveBeenCalledTimes(1);
    expect(check.mock.calls.at(-1)![1].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(check).toHaveBeenCalledTimes(5);
    expect(() => f.seat.current()).toThrow();
  });
  it("leaves expiry armed during a hung check and ignores late success", async () => {
    let resolve!: (result: {identity: ReturnType<typeof identity>; scope: string}) => void;
    let signal!: AbortSignal;
    const f = fixture((_identity, currentSignal) => {
      signal = currentSignal;
      return new Promise(done => {resolve = done;});
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(signal.aborted).toBe(true);
    expect(f.closed).toHaveBeenCalledTimes(1);
    resolve({identity: identity(), scope});
    await Promise.resolve();
    expect(() => f.seat.current()).toThrow();
    expect(f.closed).toHaveBeenCalledTimes(1);
  });
  it.each(["denied", "throw", "person", "scope", "logout", "expired"])("closes on %s renewal", async fault => {
    const f = fixture(async () => {
      if (fault === "throw") throw new Error("Host unavailable");
      if (fault === "denied") return;
      return {scope: fault === "scope" ? "different" : scope,
        identity: {...identity(),
          ...(fault === "person" ? {id: "another-person"} : {}),
          ...(fault === "logout" ? {logoutUrl: "/different"} : {}),
          ...(fault === "expired" ? {expiresAt: Date.now()} : {}),
        }};
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(f.closed).toHaveBeenCalledTimes(1);
    expect(() => f.seat.current()).toThrow();
  });
  it("fresh equal-ceiling checks do not extend expiry or halve into a hot loop", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const original = identity(101_000);
    const replay = Object.freeze({identity: Object.freeze({...original}), scope});
    const check = vi.fn(async () => replay);
    const closed = vi.fn();
    const seat = new ExternalAdmissionSeat(original, origin, closed,
      {scope, signal: new AbortController().signal, revalidate: check});
    // Repeated identical results are accepted only as fresh successful checks. They
    // retain the original absolute ceiling, including the complete final window.
    await vi.advanceTimersByTimeAsync(99_999);
    expect(check).toHaveBeenCalledTimes(3);
    expect(seat.current().expiresAt).toBe(101_000);
    expect(closed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(check).toHaveBeenCalledTimes(3);
    expect(() => seat.current()).toThrow();
  });
  it("honors a freshly narrowed finite deadline without extending the old one", async () => {
    const check = vi.fn(async () => ({identity: identity(Date.now() + 20), scope}));
    const f = fixture(check);
    await vi.advanceTimersByTimeAsync(69);
    expect(f.seat.current().expiresAt).toBe(1070);
    expect(f.closed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.closed).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledTimes(1);
  });
  it("keeps browser fixed admission finite without a renewal provider", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const closed = vi.fn();
    const seat = new ExternalAdmissionSeat(identity(), origin, closed);
    await vi.advanceTimersByTimeAsync(99);
    expect(seat.current().id).toBe("person-one");
    await vi.advanceTimersByTimeAsync(1);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(() => seat.current()).toThrow();
  });
});
