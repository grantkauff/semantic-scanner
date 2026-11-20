# Contributing

Installers should follow [README](./README.md); app users should follow the
[user guide](./docs/USER_GUIDE.md). This document is for source changes and
release maintenance. Neither installation nor normal operation requires an
AI assistant, Copilot, an MCP server, or an AI subscription.

## Safe local development

Use Node.js 24 and its matching npm from the workspace root. Other major
versions are not supported. Do not rely on an outer runtime wrapper while
nested npm still resolves an unsupported global Node.

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run setup
npm run dev
```

`npm run dev` and its compatible `npm run dev:frontend` alias start only Vite.
They do not provision or update Fabric. Options reach Vite, for example:

```powershell
npm run dev -- --host localhost --port 5173 --strictPort
```

Without a configured Fabric backend, expect first-run setup guidance, not
invented model data. Local automatic app sign-in reuses CLI-backed
`npm run login`. Keep the auth bootstrap, provider, authentication gate,
protected hosting, and disabled password authentication intact.

Interactive workspace-connection testing also needs the exact localhost
`discovery-redirect.html` URI registered in the source SPA, for example
`http://localhost:5173/discovery-redirect.html` if that is Vite's printed origin.
If the port changes, register the actual allowed origin; do not introduce a
cross-origin redirect workaround.

### Remote-changing commands are deliberate

Use `npm run doctor -- --remote` or `npm run deploy:preview` for the
read-only target preview, and `npm run deploy` for exact workspace confirmation,
serial validation, deployment, and management health checking.

**Compatibility change:** `npm run rayfin:up` now delegates to the same guarded
deployment helper. It no longer runs an untargeted native deployment.
Unattended approval, force flags, and direct target overrides are not supported;
change the three local IDs through setup, then preview again.

The SDK's generic `rayfin dev` is different from this app's root `dev` script:
it can provision or update Fabric resources. Native CLI commands use their
own targeting rules rather than the scanner's local settings. They are not an
installer shortcut. Backend/capability development requires an explicitly
approved architecture and target plus the installed, version-matched docs.
Never silently restore remote provisioning to the default development command.

## Validation

Run the applicable final gates once, serially:

```powershell
npm run typecheck
npm run build
npm run lint
npm test
npm run validate:visual
```

The build uses `tsc -b --noCheck`; it does not prove type safety. Typecheck and
build share project outputs and must not run concurrently.

Root tests include installer/target safeguards, actual safe-development
argument forwarding, blocked noninteractive deployment, and the frontend
suite. Command-contract tests copy the real scripts into temporary projects,
use synthetic settings and private npm configuration, and replace Vite and the
Fabric CLI with recording fakes. They must not use a developer's deployment
state, credential cache, or running servers.

Frontend cases cover paginated discovery, personal workspaces,
untrusted continuations, partial failures, multi-workspace selection, manual
scans, stopped queues, stale account/session completions, hidden-parent scope,
whitespace, the exact 2,000-object bound, incomplete responses, and readiness
interpretation. Recognized positive/negative instruction-content cases are
regressions; the empty-metadata query shape was also exercised on the pilot.
The DAX authentication cases exercise the installed SDK against mocked HTTP,
including rejected sessions and account changes during a request.
Fixtures do not establish another tenant's live permissions.

The unused settings-draft form and generic managed-connector query hook retain
their tests in a separate opt-in suite:

```powershell
npm run test:optional
```

Run it when changing those retained helpers. It is not part of `npm test` or
the deployment gate. Both frontend suites fail when no matching tests are
found; do not enable empty-suite success to bypass a missing test selection.

On resource-constrained systems, the existing test commands can bound Vitest:

```powershell
npm test -- -- --pool=forks --maxWorkers=1
```

`npm run validate:visual` checks statically resolvable visual specs. A zero exit
with incomplete/partial coverage is not a full visual pass: exercise
runtime-built charts and inspect the console. No persistence CRUD checks apply
while the scanner owns no records. See the [app-validation guide](./.agents/skills/app-validation/SKILL.md)
for browser coverage, including protected/restored and actual embedded behavior.
Unit-test popup and visual mocks do not replace checking sign-in and real
chart rendering in the browser.

CI checks Windows/Linux with Node 24. It installs without lifecycle scripts,
runs the gates, and then exercises noninteractive local setup and local doctor
with clearly synthetic test IDs. It needs no Fabric or AI credentials and
does not log in, deploy, grant consent, or prove source access.

## Source layout and optional template tooling

| Location | Ownership |
| --- | --- |
| `packages/frontend/` | React/Vite app, auth, scanner, UI, queries, and tests. |
| `packages/shared/` | Browser-safe contracts and settings validation. |
| `packages/data/` | Minimal runtime registration stub, still referenced by builds/typecheck; no scanner database is enabled. |
| `rayfin/` | Portable service configuration and template metadata. Ignored deployment/env state is installation-local. |
| `scripts/` | Human onboarding, visual validation, and contributor scaffolding/tests. |
| `.agents/skills/` | Optional assistant guidance **and actual pack manifests/seed kits** used by the scaffolder. Keep it in source distributions. |
| `.github/` | Credential-free validation workflow; no automatic publication/deployment. |
| `AGENTS.md`, `.mcp.json` | Optional contributor assistant context; not invoked by human setup/deployment. |

The scanner already includes its selected frontend dependencies. **Do not
reapply packs to install it in another tenant.** Available guides are not all
enabled app features. Retained skills/kits do not require a human installer to
run an AI service.

For an explicitly approved future feature, start with
[capability routing](./.agents/skills/capability-router/SKILL.md). Examples of
contributor-only packs:

| Future need | Command | Guide |
| --- | --- | --- |
| App-owned records | `npm run pack:add -- data-modeling` | [Data modeling](./.agents/skills/data-modeling/SKILL.md) |
| Files or attachments | `npm run pack:add -- storage` | [Storage](./.agents/skills/storage/SKILL.md) |
| Existing Fabric sources | `npm run pack:add -- connectors` | [Connectors](./.agents/skills/connectors/SKILL.md) |
| Existing semantic-model analytics | Apply `connectors`, then `analytics`, in separate commands | [Analytics](./.agents/skills/analytics/SKILL.md) |
| Charts/grids | `npm run pack:add -- visuals` | [Visuals](./.agents/skills/visuals/SKILL.md) |
| Trusted server-side work | `npm run pack:add -- functions` | [Functions](./.agents/skills/functions-capability/SKILL.md) |

Storage is still rolling out and is not enabled in every Fabric environment.
Stop if the target reports it unavailable. Packs mutate manifests, services,
and orchestration; apply them serially, one pack per command, before editing
their seeds. Stop on preserved files or rollback conflicts and follow
[failure recovery](./scripts/pack-manifest.md#failure-recovery).
Do not use `--force-seeds` without approval to discard the existing file.
Changing this read-only scanner's enabled services also requires revisiting
the guarded installer's explicit product contract.

`scripts/scaffold.mjs` reads `.agents/skills`; do not ignore/delete that
directory while keeping the scaffolder. Preserve the CLI-managed
`rayfin/.lockfile.json` agent-file baseline too. `npm run test:template` is the
separate contributor suite for retained template functionality, not a tenant
installation requirement.

## Installed contracts and security boundaries

Read each relevant installed package's `package.json`, follow `rayfinDocs.dir`,
then its documentation index and exact task page. CLI guidance belongs to
`@microsoft/rayfin-guide`. Keep direct SDK/CLI pins aligned, retain the lockfile,
and install from the workspace root; no nested installs or lockfiles.

Source acquisition uses a customer-owned, secretless, single-tenant SPA with
PKCE and delegated `Workspace.Read.All` / `Dataset.Read.All`. Public tenant/client
IDs come from ignored local settings at build time; missing/malformed settings
stop source sign-in with actionable guidance. Do not restore publisher IDs or
a fixed source model.

The Fabric API lists `/v1/workspaces` and nested workspace
`items?type=SemanticModel`. Continuations are restricted to the same Microsoft
origin and catalog endpoint before sending credentials. Targets come from the
current account's live catalog.

The installed semantic-model SDK's public `executeDaxDirect` / `toQueryResult`
APIs use a private, tenant/account/generation-pinned delegated transport and the
model-scoped `executeDaxQueries` route. Classic `executeQueries` does not support
these INFO queries and is not a fallback. Do not impersonate a CLI host, decode
app-session tokens, retarget a managed connector, relay credentials between
tabs, or fall back to owner credentials.

The [description query](./packages/frontend/src/queries/description-inventory.dax)
projects only names, descriptions, visibility, and a metadata-only count. It
does not query business rows, execute measures, request expressions, or use
`COLUMNSTATISTICS()`. The optional SQLite catalog is disabled because it also
acquires expressions and row-derived statistics. The
[instructions query](./packages/frontend/src/queries/ai-instructions.ts) reads
bounded linguistic content, not a full definition; embedded text remains data.
No managed semantic-model connector is configured. Its SDK stays installed for
public direct execution/normalization, not a publisher-owned binding.

Production app and callback documents add CSP and `no-referrer` metadata.
Scripts are same-origin only, without inline script or `eval`. Connections are
limited to the configured HTTPS app API origin and the approved Microsoft
authentication/Fabric/Power BI endpoints; inline styles remain allowed for UI
and visual libraries. The visual renderer is CSP-safe. Local HMR/auth remains
a development-only path.

Document metadata cannot set `frame-ancestors`, `X-Content-Type-Options`, or
`Permissions-Policy`; the installed hosting guide exposes no custom-header
setting. Do not add ineffective meta directives, deny Fabric framing, or
introduce opener policies that break sign-in popups. Sharing, MFA/Conditional
Access, consent, and effective source permissions remain administrator concerns.

Retain the targeted MSAL Node 7.1.0, Zod 4.6.6, Glob 14.0.2, and Minimatch
11.0.1 security overrides until supported upstream resolutions include the
fixes. Some cross major versions: changes require CLI sign-in/preview and the
full gates, not just a successful frontend build. Browser MSAL is unchanged.

### Persistence is not approved by the current design

Dynamic read-only scanning does not establish these deferred production gates:

1. The full Read/Build/writer/OLS matrix across identities and supported model
   types, beyond existing account isolation, bounded queries, and decoding.
2. Trusted caller/source binding and live source authorization for every
   retained result, detail, aggregate, and export. Revocation, downgraded
   permission, OLS changes, and failed checks must fail closed; generated APIs
   must not bypass that boundary.

A future managed semantic-model connector is model-bound. Documented Functions
resource tokens use the app owner's identity, not the caller's. Owner-only
database policies do not solve historical-result reauthorization. UI state and
TypeScript contracts are not authorization boundaries; legacy draft policy
contracts/helpers are not exposed or applied by this scanner.

No evidence API, persistence entity, or gateway is preapproved. If a supported
native path cannot meet both gates, stop for a separate architecture decision.
A customer-hosted delegated/OBO gateway would need separate hosting,
registration/consent, credential operations, and a proved non-bypassable
app-managed SQL access path.

Authoritative contracts:
[connectors](https://learn.microsoft.com/en-us/fabric/apps/connectors),
[Functions external-resource identity](https://learn.microsoft.com/en-us/fabric/apps/functions-connect-external-resources),
[Fabric authentication](https://learn.microsoft.com/en-us/fabric/apps/fabric-authentication),
[app-owned data permissions](https://learn.microsoft.com/en-us/fabric/apps/data-permissions).

## Release checklist

- [ ] Review intended source files **and all Git history** for credentials,
      customer data/screenshots, internal-only material, and generated state.
      Rotate exposed credentials before changing repository visibility.
      Ignore rules do not erase history.
- [ ] Ensure all required app, installer, documentation, lockfile, shared
      skills/kits, and CI files are actually committed, not merely present
      locally. Check `git status --short --untracked-files=all` and `git ls-files`.
      An old commit containing only a license is not an installable release.
- [ ] Exclude local scanner settings, `.env` files, auth/token caches,
      deployment registries, build output, and diagnostic logs. Review any
      deployment-added hosting origin in source YAML before distributing a
      portable release. Do not distribute a publisher-configured bundle.
- [ ] Preserve both license files and build-generated third-party notices when
      distributing compiled assets.
- [ ] From a clean source checkout and npm configuration without developer
      credentials, run dependency restoration, all serial gates, and the
      documented setup/local-doctor path. Use synthetic IDs **only for local
      smoke tests**, never login, remote doctor, or deployment.
- [ ] Have an independent administrator follow only README, without AI help,
      in a separate tenant. Verify real registration, consent, exact target
      confirmation, protected hosting, both sign-ins, a supported model scan,
      ordinary-user sharing, and the actual embedded/standalone behavior.
      Record unsupported permissions/model behavior and the sign-in limitation.
      Local tests and a dry run do not prove this acceptance gate.
- [ ] Configure the GitHub repository's template setting, private vulnerability
      reporting, and available secret scanning/push protection as appropriate.
      These are owner actions, not setup/deployment operations.
- [ ] Publish a reviewed version tag/release with prerequisites, supported
      tooling, known limitations, and upgrade instructions only after approval.
      Keep `"private": true`: it prevents accidental npm publication, not
      GitHub cloning or Fabric deployment.

Use the [security policy](./SECURITY.md) for vulnerability reports. This
community application is not an official Microsoft product or a security or
compliance certification.
