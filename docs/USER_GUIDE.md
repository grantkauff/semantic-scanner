# Semantic Scanner user guide

For installation, use the [installation guide](../README.md). Normal users
need only the installed app's URL and permission to the semantic models they
want to inspect; they do not need Node.js or AI tooling.

## Two different sign-ins

1. **App sign-in** protects the hosted application. Standalone access may open
   a Fabric/Microsoft popup before the app loads. Complete it in a regular
   browser. CLI sign-in is a separate session.
2. **Connect workspaces** establishes the scanner's explicit delegated source
   connection. Its account is displayed in the UI and is not inferred from an
   opaque app session. Complete that popup and check the account before scanning.

**Change account** selects another source account. **Refresh inventory**
updates the current account's catalog without another interactive sign-in.
Changing the source account clears the catalog, selections, and findings.

Source accounts and access tokens use a private, memory-only MSAL cache.
MSAL can use session storage for temporary sign-in transaction state; it is
not a scan database. Reloading requires reconnecting to workspaces, even if
the primary app session is restored. Tabs do not share workspace connections
or scan results.

### Recover a workspace connection

If you close or block the popup, choose **Reopen sign-in** on **Workspaces &
models**. It is available while sign-in is pending and after a sign-in error.
It cancels the pending attempt and starts a fresh one; there is no automatic
retry. Close any earlier sign-in window yourself.

If workspace sign-in **times out inside Fabric**, the app shows **Trouble
connecting inside Fabric?** with **Open scanner in a new tab**. This appears
only after an actual timeout, not initially, during sign-in, or for other
errors. Retrying hides it.

Connect and scan in the new tab. Signing in there does not connect the Fabric
view, and selections/results stay per tab. The link opens the current scanner
address without query parameters or fragments. Protected hosting and normal
Microsoft sign-in still apply. This is a workaround for the embedded
communication limitation, not an embedded-authentication fix. The installer
can also provide the standalone Hosting URL directly.

If app sign-in remains disabled with **Opening sign in...** after an interrupted
attempt, reload the hosting page before retrying. For integrated-browser popup
issues, use a regular browser. Never work around sign-in by making assets public
or disabling the authentication gate.

## Choose workspaces and models

1. Open **Workspaces & models** and choose **Connect workspaces**.
2. Select workspaces from the connected user's live catalog, including
   personal workspaces when accessible.
3. Select the semantic models to inspect, then start the scan.

Discovery uses your effective source permissions, not the deployment owner's
credentials. The app is not bound to a publisher's model. Identical model
names in different workspaces retain distinct workspace/model identities,
selections, scan targets, and results.

Inventory search is an inspection filter, not a change to the selected scope.
Changing workspace/model selection invalidates old findings. Refreshing
inventory clears findings and retains selections for models still present.
Switching between the three views reuses the current scope and results; it
does not scan again.

## Run and interpret a scan

Scans read semantic-model metadata: names, descriptions, visibility, model
description presence, and bounded AI-instruction metadata. They do not query
business rows, execute business measures, acquire expressions or row statistics,
or change the model.

The queue bounds concurrent model reads. **Stop scan** stops queued
work and prevents stale completions from replacing newer results. Pending,
reading, stopped, failed, not-scanned, and successful outcomes remain distinct.
A failed model does not erase another model's successful findings.

### Description findings

The app identifies missing table, column, and measure descriptions.
Whitespace-only descriptions count as missing. Hidden objects and children of
hidden tables are excluded from eligible coverage; hidden-parent exclusion
takes precedence over a child's visibility.

Each description query acquires at most 2,001 metadata rows and accepts at most
2,000 objects per model, including excluded objects. A source-computed metadata
count detects incomplete responses before findings or coverage totals are
shown. An empty response is not described as an empty model.

Permission, unsupported-model/query, over-limit, malformed, or incomplete
responses remain explicit. They are not interpreted as missing metadata or
perfect coverage.

### AI readiness

The comparison table appears before the coverage chart. The shared scan action
works on all three views; choose the scope on **Workspaces & models** and use
**Description findings** for detailed outcomes.

- Expand **Readiness guide**, even before connecting or scanning, for the
  distinct roles of model descriptions, field descriptions, and AI instructions
  and where to maintain each.
- **Tables described**, **Columns described**, and **Measures described**
  use eligible objects from successfully inspected models. Portfolio percentages
  are weighted from summed object counts, not averages of model percentages.
- Coverage bars expose described/eligible counts on hover or keyboard focus.
  Opening a model shows a keyboard-accessible details panel. Its close button
  or Escape returns focus to the model.
- The chart compares described/missing tables, columns, and measures. Select
  a bar for its counts. Grid filters do not change portfolio coverage.
- Before scanning, values show **Not scanned yet**. Failed, stopped, pending,
  not-scanned, and empty metadata responses contribute no denominator.
  **N/A** requires a successfully inspected scope with zero eligible objects.
  Unknown evidence is **Needs review**, not zero coverage or a perfect result.
- The model grid distinguishes **Semantic model**, **Workspace**, **Metadata
  scan**, **Tables %**, **Columns %**, **Measures %**, **Model description**,
  and **AI instructions**. An acquisition failure remains **Scan failed**;
  presence checks use **Present**, **Missing**, and **Needs review**.

**Model description** checks nonblank catalog-description presence only when
that property was actually returned. Only the presence state is retained.
Refresh inventory after changing it. This is not an AI-instructions check.

**AI instructions** checks the root `CustomInstructions` string in recognized
JSON linguistic metadata: LSDL versions `2.0.0` and `4.2.0`.

- **Present**: nonblank instructions were found in at least one returned culture.
- **Missing**: all returned, recognized cultures were inspected without finding
  nonblank instructions.
- **Needs review**: missing/empty metadata, unsupported version or
  representation, oversized/incomplete results, permission failures, or query
  failures prevent a conclusion. The model shows a safe reason.

Instructions are attempted even if description acquisition fails, unless source
authentication fails. Instruction-query errors do not discard successful
description findings. Acquisition is bounded to 16 metadata records/cultures
and 262,144 content characters per culture. A source-count record detects
missing rows; over-limit content is withheld by the DAX projection. Raw content
is parsed in memory and discarded. Instruction text is never logged, saved,
rendered, executed, or used as agent instructions.

Coverage and presence do not certify description quality, AI usefulness, unseen
metadata, or **Approved for Copilot** status. That unsupported approval check
is not included. No AI model is invoked to produce these checks.

References:
[model descriptions and Copilot discovery](https://learn.microsoft.com/en-us/power-bi/create-reports/tutorial-copilot-power-bi-prepare-model#descriptions),
[description usage by Copilot feature](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-prepare-data-ai-faq#tooling-features),
[AI instructions](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-prepare-data-ai-instructions),
[linguistic metadata query](https://learn.microsoft.com/en-us/dax/info-linguisticmetadata-function-dax),
[definition API permissions](https://learn.microsoft.com/en-us/rest/api/fabric/semanticmodel/items/get-semantic-model-definition).

## Data handling and access

- Results stay in the current React component state. Reloading, sign-out, or
  changing the authenticated principal clears them. Sessions without a public
  identity reset on replacement rather than reusing earlier results.
- Rescanning hides previous findings while loading and does not leave them
  visible after a failure. Source-account changes clear old source credentials
  and results. Unmounting clears the private cache and aborts source requests.
- Tokens never enter catalog or scan-result state. SDK-managed app
  authentication may persist separately for sign-in.
- There is no saved history, export, policy administration, expression storage,
  shared query cache, or browser-storage database. Data, storage, and Functions
  services are disabled. The earlier Fabric IQ diagnostic is not part of the app.

The organization's secretless, single-tenant source registration requests
delegated `Workspace.Read.All` and `Dataset.Read.All`. The latter is broader
than metadata-only access; the application's restricted queries do not narrow
the platform permission itself. Power BI enforces effective source access,
which can differ for descriptions and linguistic metadata. Sharing the
application does not grant model access.

## Sign-in and installation troubleshooting

| Symptom | Action |
| --- | --- |
| Missing or malformed installation IDs | The installer should run `npm run setup`, then `npm run doctor`. Do not paste secrets into settings. |
| Unsupported runtime or nested npm uses another Node version | Switch the shell to Node 24 and its matching npm before retrying. An outer runtime wrapper may not control nested npm. |
| Package download or TLS error | Use your organization's approved npm network/proxy settings. The Microsoft scope feed is configured in the project. Do not disable TLS checks or upgrade pins to work around a blocked download. |
| Preview cannot resolve the workspace | Verify configured IDs, CLI tenant/account, and workspace access with the administrator. Preview cannot create a missing workspace. |
| Preview succeeds but deployment fails | Check Fabric Apps enablement, capacity, and permission to create/update the app. Preview does not establish these. |
| Deployment upload succeeded but management health failed | Follow the CLI status/error. Do not claim runtime success or share the app yet. |
| Entra redirect mismatch | Add the exact printed callback as a **Single-page application** URI in the printed client registration. Do not use a Web redirect or guess another origin. |
| Consent is denied or requires approval | Ask the tenant administrator to review the two delegated permissions and tenant policy. The installer does not grant consent. |
| App sign-in popup is blocked or interrupted | Allow the popup, reload an interrupted **Opening sign in...** page, and use a regular browser. Keep protected hosting enabled. |
| Workspace sign-in was closed or blocked | Allow popups and choose **Reopen sign-in**. Close the older popup yourself. |
| Workspace sign-in times out inside Fabric | Choose the timeout-only **Open scanner in a new tab**, then connect and scan there. The embedded view does not connect automatically. |
| Model scan fails or returns Needs review | Check effective Read/Build and metadata permissions, model/query support, and the per-model reason. An inaccessible or incomplete result is not missing metadata. |
| Fabric still runs the older version after an update | Reload that Fabric tab. **Refresh inventory** updates catalog data, not the app bundle. |

For deployment changes, use the [installation guide](../README.md).
For maintainer validation and architecture, use [Contributing](../CONTRIBUTING.md).
