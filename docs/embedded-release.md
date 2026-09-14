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

## Host connection lifetime

`fetchWithIdentity(request, env, ctx, identity)` validates a finite host admission and closes its native WebSocket at that deadline. No HTTP header or client RPC argument can create or renew this authority. The default path remains suitable for a host whose connection admission has that same lifetime.

A trusted embedding backend can pass an optional fifth `ExternalConnectionAuthority` argument for a longer authorized execution. Construct this object inside the backend isolate after verifying the host's machine or execution authority; JavaScript callbacks do not travel through Worker service bindings. It contains:

- `scope`: a bounded opaque ASCII identifier for the exact host-owned execution context. Include all host authorization dimensions in a canonical representation; an account identifier alone is insufficient when resource access depends on context.
- `signal`: the live host authority's cancellation signal.
- `revalidate(previousIdentity, signal)`: an asynchronous current-authority check returning `{identity, scope}` or `undefined` to deny access. The supplied signal cancels pending checks when the native connection ends.

Every returned identity must preserve the original account, display name and sign-out destination, and return the exact original scope. Each deadline must remain in the future and be at most five minutes from validation. A fresh successful check may advance the deadline, confirm the same absolute ceiling, or narrow it. Equal expiry leaves the original timer armed and never extends access; a narrower expiry takes effect immediately. After an unchanged or narrower result, the next check is scheduled at the lesser of 30 seconds and the remaining lifetime, avoiding a rapidly halving final window. The native seat keeps the previous deadline armed throughout every asynchronous check. Denial, failure, cancellation, an expired result or a check that outlives the previous deadline closes the connection. A late response cannot revive it.

Renewal preserves the same native transport and issued capability graph. It does not reconnect, create another account or grant new resource permissions. Existing native sharing, observer checks and parent-capability disposal still govern open work and contribution capabilities. The host must retain those parent capabilities for the authorized execution lifetime.

A short handshake proof is not an execution grant. A longer execution may have a separate fixed, finite authorization ceiling and a live revocation signal; renewed native deadlines must never exceed that ceiling. The host's callback must check current authority and that ceiling, not repeatedly extend an expired browser proof. The host owns this issuer and current-membership integration; providing the native callback interface does not implement them.
