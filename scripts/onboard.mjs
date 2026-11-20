import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { parse as parseYaml } from 'yaml';

import {
  readScannerSettings, saveScannerSettings, scannerConfigFile,
} from './scanner-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const commands = new Set(['setup', 'login', 'doctor', 'preview', 'deploy']);
const help = `Semantic scanner setup

npm run setup                 Save your tenant, SPA client, and target workspace IDs locally
npm run login                 Sign in to the configured tenant using the installed CLI
npm run doctor                Check local settings and report remaining manual prerequisites
npm run doctor -- --remote     Also resolve the workspace using a read-only deployment preview
npm run deploy:preview        Show that same read-only preview
npm run deploy                Preview, confirm the workspace, validate, and deploy
npm run dev                   Start the local frontend only; do not provision Fabric

Non-interactive local setup:
npm run setup -- --tenant-id <guid> --client-id <guid> --workspace-id <guid>

Setup makes no remote changes. Entra SPA registration and consent are tenant-owned
prerequisites. Never supply a client secret or access token to this helper.`;

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function assertSupportedNode(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (!(major === 24 || (major === 22 && minor >= 13))) {
    throw new Error('Use Node.js 24 LTS, or Node.js 22.13+ within 22.x, with its matching npm. Switch runtimes before retrying.');
  }
}

export function checkProject(projectRoot) {
  const config = parseYaml(readFileSync(resolve(projectRoot, 'rayfin', 'rayfin.yml'), 'utf8'), { maxAliasCount: 0 });
  const services = config?.services;
  if (
    !object(services) || services.auth?.enabled !== true ||
    services.auth.fabric?.enabled !== true || services.auth.fabric.externalEntraExchange !== true ||
    services.auth.password?.enabled !== false ||
    services.staticHosting?.enabled !== true || services.staticHosting.assetAccess !== 'protected' ||
    services.staticHosting.embedded?.only !== false
  ) {
    throw new Error('Restore protected static hosting, Fabric sign-in, external Entra exchange, standalone support, and disabled password authentication in rayfin/rayfin.yml.');
  }
  if (
    ['data', 'storage', 'functions', 'connectors'].some((name) => services[name]?.enabled !== false) ||
    (config.connectors !== undefined && (!Array.isArray(config.connectors) || config.connectors.length !== 0))
  ) {
    throw new Error('This scanner uses live delegated discovery, not a fixed connector or app-owned backend data. Keep data, storage, functions, and managed connectors disabled.');
  }
  if (typeof config.id !== 'string' || !config.id.trim()) {
    throw new Error('Set a nonempty application id in rayfin/rayfin.yml.');
  }
  const manifests = ['package.json', 'packages/frontend/package.json', 'packages/data/package.json'];
  const versions = manifests.map((file) => JSON.parse(readFileSync(resolve(projectRoot, file), 'utf8')));
  const expected = versions[0].devDependencies?.['@microsoft/rayfin-cli'];
  if (typeof expected !== 'string' || !/^\d+\.\d+\.\d+$/.test(expected)) {
    throw new Error('Keep the project CLI pinned to an exact supported release.');
  }
  for (const manifest of versions) {
    for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
      if (name.startsWith('@microsoft/rayfin-') && version !== expected) {
        throw new Error(`Keep ${name} aligned with the exact installed CLI release. Do not upgrade one SDK package independently.`);
      }
    }
  }
  return { itemName: config.id, cliVersion: expected };
}

function cliEntry(expectedVersion) {
  let manifestPath;
  try {
    manifestPath = require.resolve('@microsoft/rayfin-cli/package.json');
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    throw new Error('The project CLI is missing. Run npm ci from the repository root.');
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== expectedVersion || typeof manifest.bin?.rayfin !== 'string') {
    throw new Error('The installed CLI does not match package.json. Run npm ci; do not use a global or latest CLI.');
  }
  return resolve(dirname(manifestPath), manifest.bin.rayfin);
}

function runCli(entry, args, interactive = false) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: root,
    env: process.env,
    stdio: interactive ? 'inherit' : 'pipe',
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (interactive) {
    if (result.status !== 0) throw new Error('Microsoft CLI sign-in did not complete. Retry npm run login and check tenant access or OS credential storage.');
    return;
  }
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error('The CLI did not return valid JSON. Check CLI installation, sign-in, and its diagnostic log; no deployment success is claimed.');
  }
  if (result.status !== 0 || !object(value)) {
    console.error(result.stderr || 'The CLI reported a failure. Check its diagnostic log.');
    const hint = typeof value?.hint === 'string' ? ` ${value.hint}` : '';
    throw new Error(`Rayfin ${args[0]} failed.${hint} Run npm run login if authentication is required.`);
  }
  if (result.stderr) process.stderr.write(result.stderr);
  return value;
}

export function inspectPreview(value, settings, itemName) {
  const plan = value?.plan;
  const readiness = plan?.targeting?.fabricReadiness;
  if (
    value?.status !== 'dry-run' || value.blocked !== false || !object(plan) ||
    typeof plan.workspaceName !== 'string' || !plan.workspaceName.trim() ||
    plan.workspaceId?.toLowerCase() !== settings.workspaceId ||
    plan.itemName !== itemName ||
    plan.services?.auth !== true || plan.services.staticHosting !== true ||
    ['data', 'storage', 'functions'].some((key) => plan.services[key] !== false) ||
    !Array.isArray(plan.connectors) || plan.connectors.length !== 0 ||
    !object(readiness) ||
    ['startTrialIfNeeded', 'createWorkspaceIfNeeded', 'assignCapacityIfNeeded'].some((key) => readiness[key] !== false)
  ) {
    throw new Error('The preview did not verify the exact configured workspace, item, and no-capacity-change plan. Nothing was deployed.');
  }
  if (!Array.isArray(value.warnings) || value.warnings.length !== 0) {
    throw new Error('The preview reported warnings. Resolve them using the CLI diagnostics before deploying.');
  }
  return plan;
}

export function readDeployment(projectRoot, settings, itemName) {
  const registry = JSON.parse(readFileSync(resolve(projectRoot, 'rayfin', '.deployments.json'), 'utf8'));
  if (!object(registry.deployments)) throw new Error('The CLI deployment registry is incomplete. No runtime success is claimed.');
  const matches = Object.values(registry.deployments).filter((entry) =>
    object(entry) &&
    entry.fabricWorkspaceId?.toLowerCase() === settings.workspaceId &&
    entry.fabricTenantId?.toLowerCase() === settings.tenantId &&
    entry.itemName === itemName,
  );
  if (matches.length !== 1) throw new Error('The CLI did not record one deployment for this tenant, workspace, and item. Check npm run deploy:preview.');
  const deployment = matches[0];
  const url = URL.parse(deployment.hostingUrl);
  if (
    !url || url.protocol !== 'https:' || url.username || url.password ||
    url.search || url.hash || url.pathname !== '/'
  ) {
    throw new Error('The CLI did not record a valid HTTPS hosting origin. Do not register an unverified redirect URI.');
  }
  return { ...deployment, callbackUrl: new URL('/discovery-redirect.html', url).href };
}

function printManualReadiness(log) {
  log('MANUAL: Ask your Fabric administrator to confirm capacity, Fabric Apps availability, and permission to create or update this app.');
  log('MANUAL: Verify the single-tenant Entra SPA, delegated Workspace.Read.All and Dataset.Read.All permissions, and any required tenant consent.');
  log('MANUAL: After deployment, register the exact printed SPA callback; then verify browser sign-in, a separate workspace connection, and a real model scan.');
}

function printPreview(plan, settings, log) {
  log(`Tenant: ${settings.tenantId}`);
  log(`Workspace: ${plan.workspaceName} (${plan.workspaceId})`);
  log(`Fabric item: ${plan.itemName}`);
  log('The CLI may create or reuse this item. No workspace, trial, or capacity assignment is requested.');
  log('CHECKED: Read-only workspace resolution and the exact item and no-capacity-change plan. No deployment was performed.');
  log('NOT CHECKED: Fabric Apps enablement, capacity, write permission, Entra registration, consent, callback correctness, or source scan access.');
  printManualReadiness(log);
}

export function doctorScanner(settings, itemName, { cli, remote = false, log = console.log } = {}) {
  if (remote) {
    const result = cli(['up', '-n', '--workspace-id', settings.workspaceId, '--tenant', settings.tenantId, '--json']);
    printPreview(inspectPreview(result, settings, itemName), settings, log);
    log('Next: complete the manual checks above, then run npm run deploy in an interactive terminal.');
    return;
  }
  log(`Configured tenant: ${settings.tenantId}`);
  log(`Configured workspace ID: ${settings.workspaceId}`);
  log(`Configured Fabric item: ${itemName}`);
  log('NOT CHECKED: Remote identity, workspace access, or deployment readiness. No sign-in or remote requests were made.');
  printManualReadiness(log);
  log('Next: npm run login, then npm run doctor -- --remote. A local pass alone is not deployment approval.');
}

async function ask(question) {
  if (!process.stdin.isTTY) {
    throw new Error('Interactive input is required. Supply all three setup IDs as flags, or run npm run deploy in a terminal to confirm its target.');
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await prompt.question(question)).trim();
  } finally {
    prompt.close();
  }
}

function runChecks() {
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Run deployment through npm run deploy so validation uses the active npm installation.');
  for (const args of [
    ['run', 'typecheck'], ['run', 'build'], ['run', 'lint'],
    ['test'], ['run', 'validate:visual'],
  ]) {
    const result = spawnSync(process.execPath, [npm, ...args], { cwd: root, env: process.env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Validation failed: npm ${args.join(' ')}. Nothing was deployed.`);
  }
}

export async function deployScanner(settings, itemName, {
  cli, checks, confirm, projectRoot = root, log = console.log,
}) {
  const target = ['--workspace-id', settings.workspaceId, '--tenant', settings.tenantId, '--json'];
  const preview = inspectPreview(cli(['up', '-n', ...target]), settings, itemName);
  printPreview(preview, settings, log);
  log('Approve only after completing the administrator and Entra checks above.');
  const approval = await confirm(`Type workspace ID ${settings.workspaceId} to deploy (blank cancels): `);
  if (approval.trim().toLowerCase() !== settings.workspaceId) {
    throw new Error('Workspace confirmation did not match. Nothing was deployed.');
  }
  checks();
  const current = readScannerSettings(projectRoot);
  if (
    checkProject(projectRoot).itemName !== itemName ||
    ['tenantId', 'clientId', 'workspaceId'].some((key) => current[key] !== settings[key])
  ) {
    throw new Error('Scanner configuration changed during validation. Preview and confirm the new target before deploying.');
  }
  const result = cli(['up', ...target]);
  if (
    result?.status !== 'success' ||
    (result.warnings !== undefined && (!Array.isArray(result.warnings) || result.warnings.length > 0)) ||
    (result.generate !== undefined && (!Array.isArray(result.generate) || result.generate.length > 0))
  ) {
    throw new Error('The CLI did not report a warning-free scanner deployment without managed connectors. Inspect its result before continuing; remote changes may have occurred.');
  }
  const deployment = readDeployment(projectRoot, settings, itemName);
  const status = cli(['up', 'status', ...target]);
  if (
    status?.endpointHealth?.authenticated !== true ||
    status.endpointHealth.httpStatus !== 200 ||
    status.endpointHealth.metadata?.error
  ) {
    throw new Error('Deployment was uploaded, but authenticated management health was not verified. Check CLI status; this does not prove app or source access.');
  }
  log(`Hosting URL: ${deployment.hostingUrl}`);
  log(`Register this exact Entra SPA redirect URI: ${deployment.callbackUrl}`);
  log(`SPA application (client) ID: ${settings.clientId}`);
  log('Deployment upload and management access verified, not runtime scan behavior.');
  log('FINISH SETUP before sharing:');
  log('1. In that Entra application, add the printed callback as a Single-page application redirect URI and complete any required consent. Do not create a client secret.');
  log('2. Open the Hosting URL in a regular browser. Verify signed-out protection, complete app sign-in, and reload to check session restoration.');
  log('3. Choose Connect workspaces and verify the source account. This is separate from app sign-in; use the standalone tab first while embedded sign-in has limitations.');
  log('4. Scan an authorized model, inspect all three views, and test the actual Fabric view before sharing. Management health does not prove source access.');
  log('See README.md for the installation acceptance checklist and docs/USER_GUIDE.md for sign-in recovery.');
  return deployment;
}

export async function setupScanner(projectRoot, values, prompt = ask) {
  const allProvided = ['tenant-id', 'client-id', 'workspace-id'].every((key) => values[key] !== undefined);
  const previous = allProvided ? undefined : readScannerSettings(projectRoot, { required: false });
  const settings = {};
  for (const [field, flag, label] of [
    ['tenantId', 'tenant-id', 'Directory (tenant) ID'],
    ['clientId', 'client-id', 'Entra SPA application (client) ID, not its object ID'],
    ['workspaceId', 'workspace-id', 'Existing capacity-backed Fabric workspace ID'],
  ]) {
    settings[field] = values[flag] ?? (
      await prompt(`${label}${previous ? ` [${previous[field]}]` : ''}: `) || previous?.[field]
    );
  }
  return saveScannerSettings(projectRoot, settings);
}

async function main(args) {
  const [command, ...options] = args;
  if (command === '--help' || command === '-h') {
    console.log(help);
    return;
  }
  if (!commands.has(command)) throw new Error(help);
  const { values } = parseArgs({
    args: options,
    options: {
      help: { type: 'boolean', short: 'h' },
      remote: { type: 'boolean' },
      'tenant-id': { type: 'string' },
      'client-id': { type: 'string' },
      'workspace-id': { type: 'string' },
    },
  });
  if (values.help) {
    console.log(help);
    return;
  }
  if (
    (values.remote && command !== 'doctor') ||
    (command !== 'setup' && ['tenant-id', 'client-id', 'workspace-id'].some((key) => values[key] !== undefined))
  ) {
    throw new Error('Use ID flags only with npm run setup, and --remote only with npm run doctor.');
  }
  assertSupportedNode();
  if (command === 'deploy' && !process.stdin.isTTY) {
    throw new Error('Deployment requires an interactive terminal for exact workspace confirmation. Run npm run deploy in a normal terminal. Nothing was deployed.');
  }
  const project = checkProject(root);
  const entry = cliEntry(project.cliVersion);
  if (command === 'setup') {
    await setupScanner(root, values);
    console.log(`Saved ${scannerConfigFile}. No deployment, sign-in, consent grant, or app registration was performed.`);
    console.log('The IDs were checked for format only. They are public identifiers, not credentials.');
    console.log('Next: npm run doctor, then npm run login and npm run doctor -- --remote. Resolve manual prerequisites before npm run deploy.');
    return;
  }
  const settings = readScannerSettings(root);
  if (command === 'login') {
    runCli(entry, ['login', '--tenant', settings.tenantId], true);
    return;
  }
  console.log('CHECKED: Supported Node, configured ID formats, installed CLI version, aligned CLI/SDK declarations, and protected read-only app settings.');
  const cli = (args) => runCli(entry, args);
  if (command !== 'deploy') {
    doctorScanner(settings, project.itemName, { cli, remote: command === 'preview' || values.remote === true });
    return;
  }
  await deployScanner(settings, project.itemName, { cli, checks: runChecks, confirm: ask });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Scanner setup failed with an unexpected error.');
    process.exitCode = 1;
  });
}
