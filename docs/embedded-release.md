# Native releases for an embedding host

The release builder supports the complete native frontend at a same-origin mount. It still builds every deployable Worker and its native manifest; these options change frontend configuration, not native capabilities or authorization.

```sh
node scripts/release/build-release.mjs --out /tmp/cf-os-host-release --auth-mode host --frontend-base /workshop/
```

`--out` is the generated release directory and is replaced by the builder. Use a dedicated output directory, never a source checkout or evidence directory. All command-line options are validated before that replacement begins.

The defaults remain `--auth-mode access --frontend-base /`. Access builds set `VITE_CF_ACCESS_MODE=true` and retain the manifest asset variant `access`. Host builds explicitly set that flag to `false` and name their variant `host`; a consuming deployment must select `assetsConfig.variants.host`. Each build contains one variant. The manifest shape and default Access variant remain unchanged.

The host mode does not grant access or put a user identity in frontend configuration. The native server advertises `externalAuthentication` only on connections admitted through its server-side `fetchWithIdentity` entry point. The browser calls native `authenticateExternal()` and uses the admitted host's same-origin sign-out page. Without host admission, this frontend follows the native server's normal authentication configuration. The host must enforce authentication, current access and revocation on every admitted connection.

`--frontend-base` uses Vite's native `--base` option. It controls built asset URLs and the native frontend router's `BASE_URL`; native share, blueprint and workspace links use the same mount. The host router must strip that UI prefix before serving the native asset handler. Existing native API and gatekeeper callback paths retain their separate routing requirements: this option does not rewrite `/api`, `/api/*`, `/blueprint-screenshot/*` or `/gatekeeper/*`. Configure and route those native endpoints explicitly.

This is a build configuration, not deployment evidence. Verify the selected asset variant, mounted deep links, actual host login/sign-out, native agents, gatekeeper callbacks and the complete Worker graph in the target environment.
