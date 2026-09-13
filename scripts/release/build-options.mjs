import { resolve } from "node:path";

/** Normalize a same-origin frontend mount without accepting URL or traversal syntax. */
export function frontendBasePath(value) {
  if (typeof value !== "string" || !/^\/(?:[A-Za-z0-9._~-]+\/?)*$/.test(value)
      || value.split("/").some(segment => segment === "." || segment === "..")) {
    throw new Error("--frontend-base must be an absolute same-origin path, e.g. /workshop/");
  }
  return value.endsWith("/") ? value : value + "/";
}

function authMode(value) {
  if (value !== "access" && value !== "host") {
    throw new Error("--auth-mode must be access or host");
  }
  return value;
}

/** Parse every build option before any subprocess or output-directory replacement. */
export function parseReleaseArgs(argv, cwd = process.cwd()) {
  const args = { out: undefined, releaseId: undefined, authMode: "access", frontendBase: "/" };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const option = argv[i];
    if (!["--out", "--release-id", "--auth-mode", "--frontend-base"].includes(option)) {
      throw new Error(`unknown argument: ${option}`);
    }
    if (seen.has(option)) throw new Error(`duplicate argument: ${option}`);
    seen.add(option);
    const value = argv[++i];
    if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
    if (option === "--out") args.out = resolve(cwd, value);
    else if (option === "--release-id") args.releaseId = value;
    else if (option === "--auth-mode") args.authMode = authMode(value);
    else args.frontendBase = frontendBasePath(value);
  }
  if (!args.out) throw new Error("--out <dir> is required");
  return args;
}

/** Native build invocation and named manifest variant; host admission is server-configured. */
export function frontendBuildSettings(options, environment = process.env) {
  const variant = authMode(options.authMode);
  return {
    variant,
    argv: ["run", "build", "--base", frontendBasePath(options.frontendBase)],
    // Explicit false is necessary: host builds must override a caller's inherited Access flag.
    env: { ...environment, VITE_CF_ACCESS_MODE: variant === "access" ? "true" : "false" },
  };
}

/** Select this native package even when an embedding repository has a deploy-config redirect. */
export function workerBuildSettings(outDir) {
  return { argv: ["exec", "wrangler", "deploy", "--config", "wrangler.jsonc", "--dry-run", "--outdir", outDir] };
}
