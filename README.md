# Semantic Scanner

A protected Fabric app for reviewing semantic-model documentation and
AI-instruction presence across workspaces you can access.

**No AI assistant, Copilot, MCP server, or AI subscription is required to
install or use it.** One technical owner deploys the app; other users open it
and connect their own workspaces.

The scanner reads metadata, not business rows. It does not change models,
save scan history, export results, or certify Copilot readiness. See the
[user guide](./docs/USER_GUIDE.md) for what each check means.

> **Known sign-in limitation:** workspace sign-in can time out inside Fabric.
> Use the standalone **Hosting URL** for the first connection test. After an
> embedded timeout, the app offers **Open scanner in a new tab**. Each tab
> needs its own workspace connection; this is a workaround, not a fix.

## Before you start

The person installing needs:

- **Node.js 24 and its matching npm**, as specified in
  [.node-version](./.node-version). Other major versions are not supported.
  Switch your shell's runtime before continuing.
- An existing Fabric workspace with suitable capacity, Fabric Apps available
  in the tenant, and permission to create or update an app there. Ask your
  Fabric administrator to confirm these. The installer does not create a
  workspace, start a trial, or assign capacity.
- Permission to create a single-tenant Microsoft Entra application, or an
  administrator who will create it and approve consent when required.
- An authorized semantic model for the final connection/scan test. Hosting
  the app does not grant access to anyone's models.

Use a reviewed source checkout or versioned source release. Open a terminal
in its root folder, then restore the locked dependencies:

```powershell
node --version
npm --version
npm ci --ignore-scripts --no-audit --no-fund
```

The project uses a token-free public Microsoft package feed for its Microsoft
packages. Do not add a publisher's npm credentials or disable TLS verification.

## 1. Create your workspace-connection registration

In the [Microsoft Entra admin center](https://entra.microsoft.com/):

1. Open **App registrations > New registration**.
2. Choose **Accounts in this organizational directory only**. This
   registration belongs to your organization, not the original app publisher.
3. Record its **Directory (tenant) ID** and **Application (client) ID**,
   not the application's object ID.
4. Add only the delegated Power BI Service permissions
   **Workspace.Read.All** and **Dataset.Read.All**. Follow your tenant's
   consent policy; obtain administrator consent if required.
5. Do **not** create a client secret, add application permissions, or enable
   implicit grant. The browser uses authorization code with PKCE.

The deployed SPA callback is not known yet. Register the exact
**Single-page application** redirect URI printed after deployment in step 4.
Do not guess a hosting URL.

`Dataset.Read.All` is broader than a metadata-only permission. The app limits
its own queries to metadata, but the platform still enforces the account's
effective Read/Build and metadata permissions. A successful app deployment
does not prove that a particular model can be scanned.

## 2. Save your three public IDs

Find the **existing deployment workspace ID** in its Fabric workspace URL.
It is the workspace that will host the scanner, not a fixed model binding.

```powershell
npm run setup
npm run doctor
```

Setup asks for the tenant ID, SPA client ID, and deployment workspace ID.
It saves them in ignored `scanner.config.local.json`; see the
[example format](./scanner.config.example.json). It never asks for a password,
token, or secret and makes no remote changes.

Doctor labels what it **CHECKED**, what is **NOT CHECKED**, and the remaining
**MANUAL** steps. ID-format checks do not prove that the registration exists.

For scripted **local configuration only**, the equivalent is:

```powershell
npm run setup -- --tenant-id <your-tenant-guid> --client-id <your-spa-client-guid> --workspace-id <your-workspace-guid>
```

Replace the placeholders with your own IDs. Do not run example or test IDs
against Fabric.

## 3. Sign in and preview the target

```powershell
npm run login
npm run doctor -- --remote
```

Use an account in the configured tenant that can deploy to the target workspace.
The remote doctor performs read-only workspace resolution and checks the
planned item and services. It does not provision or deploy anything.
`npm run deploy:preview` runs the same preview.

Check the printed **tenant, workspace name/ID, and item name**. Resolve the
manual administrator and Entra prerequisites before continuing. A preview
does not establish capacity, Fabric Apps availability, write permission,
consent, callback correctness, or source scan access.

## 4. Deploy and finish registration

Run this in a normal interactive terminal:

```powershell
npm run deploy
```

The helper previews again, requires you to type the exact workspace ID, runs
typecheck/build/lint/tests/visual checks serially, and then deploys. A cancelled
confirmation or failed validation stops before deployment. There is no
unattended approval or force option.

A partial visual report with no failures still leaves the runtime-built chart
unverified. Check the rendered **AI readiness** chart in step 5; a partial
static result is not a full visual pass.

Keep the terminal's final output:

- **Hosting URL**: the protected standalone app.
- **Exact Entra SPA redirect URI**: add this under **Authentication >
  Add a platform > Single-page application** in the registration from step 1.
- **SPA application (client) ID**: verify you are updating that registration.

Complete any required tenant consent, then continue below. Successful upload
and authenticated management access are **not** runtime or model-scan
verification.

## 5. Verify before sharing

- [ ] Open the Hosting URL signed out in a regular browser. App content and
      protected assets must require authentication.
- [ ] Complete **app sign-in**, then reload and verify that session restoration
      works. CLI sign-in and browser sign-in are separate.
- [ ] Choose **Connect workspaces**. This is a **second, separate connection**
      for delegated model access. Confirm the displayed source account.
- [ ] Select an accessible workspace/model and scan it. Check **Workspaces &
      models**, **AI readiness**, and **Description findings**. Permission or
      unsupported-query failures must stay explicit, not become zero coverage.
- [ ] Open the installed app in the actual Fabric workspace. Test its embedded
      experience and the documented standalone workaround if connection fails.
- [ ] Verify sharing and source access with an intended ordinary user, not
      only the deployment owner.

Share only after these checks. A user who can open the app still needs their
own source permissions. See [sign-in recovery and scanner usage](./docs/USER_GUIDE.md).

## Updates and local development

For an update, keep the installation's ignored local settings and deployment
state, restore dependencies from the new reviewed source, and repeat preview,
deployment, callback verification, and the acceptance checklist. Reload
already-open Fabric tabs after deployment; **Refresh inventory** does not load
a newer app bundle.

```powershell
npm run dev
```

This starts **only the local frontend** and forwards Vite options. It does
not provision or update Fabric. A fresh checkout without a configured backend
shows first-run setup guidance rather than model data. Local authenticated
testing is covered in [Contributing](./CONTRIBUTING.md).

## Help

| Problem | Next step |
| --- | --- |
| Unsupported Node, including an unsupported global runtime used by nested npm | Switch the shell to Node 24 and its matching npm, then retry. |
| Missing settings or incorrect ID format | Run `npm run setup`, then `npm run doctor`. Never supply secrets. |
| Workspace/feature/capacity or deployment permission failure | Check the target with your Fabric administrator. A preview cannot approve these prerequisites. |
| Redirect mismatch, consent, popup, or embedded timeout | Follow the [sign-in troubleshooting guide](./docs/USER_GUIDE.md#sign-in-and-installation-troubleshooting). Keep protected hosting enabled. |
| Package download/TLS failure | Check your organization's approved npm network/proxy configuration. Do not disable certificate checks or change pinned package versions. |

Maintainers: see [source release and independent-install acceptance](./CONTRIBUTING.md#release-checklist).
Optional template packs and AI tooling are contributor tools, not installation
requirements. This is a community application, not an official Microsoft
product or a security/compliance certification. Report vulnerabilities through
the [security policy](./SECURITY.md).
