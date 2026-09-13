import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReleaseArgs, frontendBuildSettings, frontendBasePath } from "./release/build-options.mjs";

test("release defaults retain the Access/root variant", () => {
  const options = parseReleaseArgs(["--out", "release"], "/repo");
  assert.deepEqual(options, { out: "/repo/release", releaseId: undefined, authMode: "access", frontendBase: "/" });
  const settings = frontendBuildSettings(options, { VITE_CF_ACCESS_MODE: "false", OTHER: "preserved" });
  assert.equal(settings.variant, "access");
  assert.equal(settings.env.VITE_CF_ACCESS_MODE, "true");
  assert.equal(settings.env.OTHER, "preserved");
  assert.deepEqual(settings.argv, ["run", "build", "--base", "/"]);
});

test("host release selects native mounted assets and overrides inherited Access mode", () => {
  const options = parseReleaseArgs(["--frontend-base", "/workshop", "--auth-mode", "host", "--out", "release", "--release-id", "native-host"], "/repo");
  const inherited = { VITE_CF_ACCESS_MODE: "true", VITE_BACKEND_HOST: "platform.example" };
  const settings = frontendBuildSettings(options, inherited);
  assert.equal(options.releaseId, "native-host");
  assert.equal(settings.variant, "host");
  assert.equal(settings.env.VITE_CF_ACCESS_MODE, "false");
  assert.equal(settings.env.VITE_BACKEND_HOST, "platform.example");
  assert.equal(inherited.VITE_CF_ACCESS_MODE, "true");
  assert.deepEqual(settings.argv, ["run", "build", "--base", "/workshop/"]);
});

test("mount validation rejects origin changes, traversal, search and ambiguous paths", () => {
  for (const value of ["https://other.example/", "//other.example/", "/../", "/app/./", "/app/%2e%2e/", "/app//nested", "/app?x", "/app#hash", "/app\\nested", "relative", " "]) {
    assert.throws(() => frontendBasePath(value), /same-origin path/);
  }
  assert.equal(frontendBasePath("/native/v2.1/"), "/native/v2.1/");
});

test("invalid or incomplete options fail before output replacement", () => {
  for (const args of [["--out"], ["--out", "--auth-mode", "host"], ["--out", "release", "--auth-mode", "native"], ["--out", "release", "--frontend-base"], ["--out", "release", "--unknown", "x"], ["--out", "release", "--auth-mode", "host", "--auth-mode", "access"]]) {
    assert.throws(() => parseReleaseArgs(args));
  }
  const directory = mkdtempSync(join(tmpdir(), "native-release-options-"));
  const sentinel = join(directory, "preserve.txt");
  try {
    writeFileSync(sentinel, "existing build evidence");
    assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL("./release/build-release.mjs", import.meta.url)), "--out", directory, "--frontend-base", "https://other.example/"], { stdio: "pipe" }));
    assert.equal(readFileSync(sentinel, "utf8"), "existing build evidence");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
