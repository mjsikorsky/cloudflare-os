# LEGION dependency maintenance — 2026-10-28

This maintenance extends the Vite 7.3.7 patch in fork PR #1. The standalone Vite
version stays on 7 because the Worker RPC decorators require its esbuild path.
Vite+ 1.3.0 is used as the task runner/linter, with package Vitest 4.1.12 retained.

The shared catalog and compatible dependency overrides patch Zod (including the
Cloudflare pool copy), Vitest/mocker, Sharp, Undici, Nano ID, source-map-js,
Tinypool, DOMPurify, IP address, basic-ftp, and the MCP client. The deployment
wrapper mirrors the same catalog/override policy.

The Vite+ cache settings move into `cache: { input, output, env }`. Commands,
cache exclusions, environment forwarding, dependencies, and uncached build
steps are preserved. The watchdog regression assertions follow that new shape.
Plugin types match Vite+'s pinned @oxlint/plugins. Freshly allocated UI arrays
use toSorted; hook-test probes explicitly document their intentional capture
of render results outside React. No production lint rule is disabled.

One scheduler fixture enabled a second schedule after making the first due,
which replanned its alarm and could deliver before fault injection. It now
enables both schedules before making either due; its original assertions stay.

## Remaining upstream advisories

The standalone fork audit retains two high-severity extract-zip 2.0.1 findings:
GHSA-jmr9-qjv8-65gv and GHSA-7pqw-9j4j-h8q3. The dependency path is
@cloudflare/puppeteer -> @puppeteer/browsers -> extract-zip. The advisory lists
2.0.2 as fixed, but the registry's latest published version is 2.0.1; attempting
to install 2.0.2 fails with ERR_PNPM_NO_MATCHING_VERSION. No advisory is dismissed
or suppressed. This is not a claim that this complete fork is audit-clean.

The deployment wrapper dependency graph does not include that downloader and
its full pnpm audit is clean. Neither repository has been deployed by this work.
