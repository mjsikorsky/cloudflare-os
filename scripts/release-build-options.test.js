import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReleaseArgs, frontendBuildSettings, frontendBasePath, workerBuildSettings } from "./release/build-options.mjs";

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


test("native release bundle ignores an embedding repository's deploy-config redirect", () => {
  const directory = mkdtempSync(join(tmpdir(), "native-release-config-"));
  const packageDir = join(directory, "vendored", "cf-os", "packages", "native-worker");
  const hostDir = join(directory, "host");
  const redirectDir = join(directory, ".wrangler", "deploy");
  for (const dir of [packageDir, hostDir, redirectDir]) mkdirSync(dir, { recursive: true });
  const config = name => JSON.stringify({ name, main: "worker.js", compatibility_date: "2026-02-02" });
  writeFileSync(join(packageDir, "wrangler.jsonc"), config("native-release-fixture"));
  writeFileSync(join(packageDir, "worker.js"), 'export default {fetch(){return new Response("NATIVE_PACKAGE_SENTINEL")}}');
  writeFileSync(join(hostDir, "wrangler.jsonc"), config("embedding-host-fixture"));
  writeFileSync(join(hostDir, "worker.js"), 'export default {fetch(){return new Response("EMBEDDING_HOST_SENTINEL")}}');
  writeFileSync(join(redirectDir, "config.json"), JSON.stringify({ configPath: "../../host/wrangler.jsonc" }));
  const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: join(directory, "wrangler-logs") };
  const run = args => execFileSync(process.execPath, [wrangler, ...args], { cwd: packageDir, env, stdio: "pipe", timeout: 30000 });
  const redirectedOut = join(directory, "redirected");
  const nativeOut = join(directory, "native");
  // The control proves the ancestor redirect makes implicit native config selection ambiguous.
  assert.throws(() => run(["deploy", "--dry-run", "--outdir", redirectedOut]), error => {
    assert.equal(error.status, 1);
    assert.match(error.stderr.toString(), /do not share the same base path/);
    return true;
  });
  run(workerBuildSettings(nativeOut).argv.slice(2)); // same arguments as pnpm exec wrangler
  const actual = readFileSync(join(nativeOut, "worker.js"), "utf8");
  assert.match(actual, /NATIVE_PACKAGE_SENTINEL/);
  assert.doesNotMatch(actual, /EMBEDDING_HOST_SENTINEL/);
  // Retain the fixture, bundle and logs as evidence, including on assertion failure.
});
