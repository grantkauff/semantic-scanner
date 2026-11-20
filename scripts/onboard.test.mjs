import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';

import {
  assertSupportedNode, checkProject, deployScanner, doctorScanner, inspectPreview, readDeployment, setupScanner,
} from './onboard.mjs';
import {
  readScannerSettings, saveScannerSettings, scannerConfigFile,
} from './scanner-config.mjs';

const settings = {
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  clientId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  workspaceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
};
const itemName = 'semantic-scanner';

function npmCommand(script, ...args) {
  assert.ok(process.env.npm_execpath, 'Run command-contract tests through npm run test:onboarding.');
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', script, '--', ...args], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, RAYFIN_TELEMETRY_OPTOUT: '1' },
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  return result;
}

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'semantic-scanner-onboarding-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(resolve(root, 'rayfin'));
  for (const directory of ['packages/frontend', 'packages/data']) mkdirSync(resolve(root, directory), { recursive: true });
  const config = {
    id: itemName,
    services: {
      auth: { enabled: true, fabric: { enabled: true, externalEntraExchange: true }, password: { enabled: false } },
      staticHosting: { enabled: true, assetAccess: 'protected', embedded: { only: false } },
      data: { enabled: false }, storage: { enabled: false },
      functions: { enabled: false }, connectors: { enabled: false },
    },
  };
  writeFileSync(resolve(root, 'rayfin/rayfin.yml'), stringify(config));
  for (const file of ['package.json', 'packages/frontend/package.json', 'packages/data/package.json']) {
    writeFileSync(resolve(root, file), JSON.stringify({
      devDependencies: { '@microsoft/rayfin-cli': '2.0.0' },
    }));
  }
  saveScannerSettings(root, settings);
  return { root, config };
}

function preview() {
  return {
    status: 'dry-run', blocked: false, warnings: [],
    plan: {
      workspaceId: settings.workspaceId, workspaceName: 'Customer workspace', itemName,
      services: { auth: true, staticHosting: true, data: false, storage: false, functions: false },
      connectors: [],
      targeting: { fabricReadiness: {
        startTrialIfNeeded: false, createWorkspaceIfNeeded: false, assignCapacityIfNeeded: false,
      } },
    },
  };
}

function registry(root, overrides = {}) {
  writeFileSync(resolve(root, 'rayfin/.deployments.json'), JSON.stringify({
    active: 'customer',
    deployments: { customer: {
      fabricTenantId: settings.tenantId, fabricWorkspaceId: settings.workspaceId,
      itemName, hostingUrl: 'https://scanner.example.invalid', ...overrides,
    } },
  }));
}

test('setup normalizes installation IDs and rejects secret-bearing or invalid settings before writing', (t) => {
  const { root } = fixture(t);
  saveScannerSettings(root, { ...settings, tenantId: ` ${settings.tenantId.toUpperCase()} ` });
  assert.deepEqual(readScannerSettings(root), settings);
  const before = readFileSync(resolve(root, scannerConfigFile), 'utf8');
  for (const invalid of [
    { ...settings, clientSecret: 'must-not-be-saved' },
    { ...settings, tenantId: 'organizations' },
    { ...settings, clientId: '00000000-0000-0000-0000-000000000000' },
    { ...settings, workspaceId: '' },
  ]) {
    assert.throws(() => saveScannerSettings(root, invalid));
    assert.equal(readFileSync(resolve(root, scannerConfigFile), 'utf8'), before);
  }
});

test('unconfigured builds are allowed explicitly but deployment settings cannot default to another tenant', (t) => {
  const root = mkdtempSync(resolve(tmpdir(), 'semantic-scanner-unconfigured-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(readScannerSettings(root, { required: false }), undefined);
  assert.throws(() => readScannerSettings(root), /npm run setup/);
  assert.equal(existsSync(resolve(root, scannerConfigFile)), false);
  writeFileSync(resolve(root, scannerConfigFile), '{"secret-value-that-must-not-appear":');
  assert.throws(() => readScannerSettings(root), (error) =>
    error.message.includes('not valid JSON') && !error.message.includes('secret-value-that-must-not-appear'),
  );
});

test('supplying all setup IDs can repair malformed local configuration without reading prompts', async (t) => {
  const { root } = fixture(t);
  writeFileSync(resolve(root, scannerConfigFile), '{invalid');
  await setupScanner(root, {
    'tenant-id': settings.tenantId, 'client-id': settings.clientId, 'workspace-id': settings.workspaceId,
  }, async () => assert.fail('All settings were explicitly provided.'));
  assert.deepEqual(readScannerSettings(root), settings);
});

test('unsupported Node runtimes cannot start onboarding', () => {
  assert.doesNotThrow(() => assertSupportedNode('24.0.0'));
  assert.doesNotThrow(() => assertSupportedNode('22.13.0'));
  for (const version of ['22.12.0', '25.0.0', '26.0.0']) {
    assert.throws(() => assertSupportedNode(version), /matching npm/);
  }
});

test('preflight refuses weakened auth, app-owned services, fixed source bindings, and mismatched SDK pins', (t) => {
  const { root, config } = fixture(t);
  assert.equal(checkProject(root).itemName, itemName);
  for (const mutate of [
    (value) => { value.services.staticHosting.assetAccess = 'public'; },
    (value) => { value.services.auth.password.enabled = true; },
    (value) => { value.services.auth.fabric.enabled = false; },
    (value) => { value.services.data.enabled = true; },
    (value) => { value.connectors = [{ name: 'fixed-model' }]; },
  ]) {
    const changed = structuredClone(config);
    mutate(changed);
    writeFileSync(resolve(root, 'rayfin/rayfin.yml'), stringify(changed));
    assert.throws(() => checkProject(root));
  }
  writeFileSync(resolve(root, 'rayfin/rayfin.yml'), stringify(config));
  writeFileSync(resolve(root, 'packages/frontend/package.json'), JSON.stringify({
    dependencies: { '@microsoft/rayfin-client': '^2.0.0' },
  }));
  assert.throws(() => checkProject(root), /aligned/);
});

test('preview must verify the exact workspace and must not request capacity or source-binding changes', () => {
  for (const mutate of [
    (value) => { value.plan.workspaceId = settings.clientId; },
    (value) => { value.blocked = true; },
    (value) => { value.plan.connectors = [{ name: 'fixed-model' }]; },
    (value) => { value.plan.services.auth = false; },
    (value) => { value.plan.targeting.fabricReadiness.assignCapacityIfNeeded = true; },
    (value) => { value.warnings = ['Environment refresh failed']; },
  ]) {
    const result = preview();
    mutate(result);
    assert.throws(() => inspectPreview(result, settings, itemName));
  }
});

test('an incorrect workspace confirmation prevents validation and all remote writes', async (t) => {
  const { root } = fixture(t);
  const calls = [];
  await assert.rejects(deployScanner(settings, itemName, {
    projectRoot: root, log: () => {},
    cli: (args) => { calls.push(args); return preview(); },
    checks: () => assert.fail('Validation must not start after cancelled approval.'),
    confirm: async () => 'yes',
  }), /confirmation did not match/);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('-n'));
});

test('local readiness requires no source or deployment authentication and leaves external checks manual', () => {
  const logs = [];
  doctorScanner(settings, itemName, {
    cli: () => assert.fail('Local doctor must not launch the CLI or request remote access.'),
    log: (message) => logs.push(message),
  });
  const output = logs.join('\n');
  assert.match(output, /NOT CHECKED: Remote identity/);
  assert.match(output, /MANUAL:.*capacity/);
  assert.match(output, /MANUAL:.*consent/);
  assert.match(output, /npm run doctor -- --remote/);
  assert.doesNotMatch(output, /CHECKED: Read-only workspace resolution/);
});

test('remote readiness uses only the exact read-only target and does not certify external prerequisites', () => {
  const calls = [];
  const logs = [];
  doctorScanner(settings, itemName, {
    remote: true,
    cli: (args) => { calls.push(args); return preview(); },
    log: (message) => logs.push(message),
  });
  assert.deepEqual(calls, [[
    'up', '-n', '--workspace-id', settings.workspaceId, '--tenant', settings.tenantId, '--json',
  ]]);
  const output = logs.join('\n');
  assert.match(output, /CHECKED: Read-only workspace resolution/);
  assert.match(output, /NOT CHECKED:.*consent.*source scan access/);
  assert.match(output, /MANUAL:.*exact printed SPA callback/);
});

test('a mismatched remote target cannot print a successful readiness check', () => {
  const logs = [];
  const wrongTarget = preview();
  wrongTarget.plan.workspaceId = settings.tenantId;
  assert.throws(() => doctorScanner(settings, itemName, {
    remote: true, cli: () => wrongTarget, log: (message) => logs.push(message),
  }), /exact configured workspace/);
  assert.deepEqual(logs, []);
});

test('the default development command forwards options to Vite without a Fabric backend session', () => {
  const result = npmCommand('dev', '--help');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /vite\/\d/);
  assert.match(result.stdout, /--host/);
});

test('the legacy deployment alias reaches guarded scanner setup rather than raw remote deployment', () => {
  const result = npmCommand('rayfin:up', '--help');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Semantic scanner setup/);
  assert.match(result.stdout, /Never supply a client secret or access token/);
});

test('noninteractive deployment stops before configuration, validation, or remote access', () => {
  const result = npmCommand('deploy');
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /interactive terminal for exact workspace confirmation/);
  assert.doesNotMatch(result.stdout, /CHECKED:|Workspace:|Hosting URL:/);
});

test('failed static validation prevents deployment even after target approval', async (t) => {
  const { root } = fixture(t);
  const calls = [];
  await assert.rejects(deployScanner(settings, itemName, {
    projectRoot: root, log: () => {},
    cli: (args) => { calls.push(args); return preview(); },
    checks: () => { throw new Error('Typecheck failed'); },
    confirm: async () => settings.workspaceId,
  }), /Typecheck failed/);
  assert.equal(calls.length, 1);
});

test('changing installation settings during validation requires a new preview and confirmation', async (t) => {
  const { root } = fixture(t);
  const calls = [];
  await assert.rejects(deployScanner(settings, itemName, {
    projectRoot: root, log: () => {},
    cli: (args) => { calls.push(args); return preview(); },
    checks: () => saveScannerSettings(root, { ...settings, clientId: settings.tenantId }),
    confirm: async () => settings.workspaceId,
  }), /configuration changed/);
  assert.equal(calls.length, 1);
});

test('successful upload checks the recorded target and management health without claiming runtime validation', async (t) => {
  const { root } = fixture(t);
  registry(root);
  const calls = [];
  const logs = [];
  let checked = false;
  const results = [
    preview(),
    { status: 'success', warnings: [], generate: [] },
    { endpointHealth: { authenticated: true, httpStatus: 200, metadata: { error: null } } },
  ];
  await deployScanner(settings, itemName, {
    projectRoot: root, log: (message) => logs.push(message),
    cli: (args) => {
      calls.push(args);
      if (!args.includes('-n')) assert.ok(checked);
      return results.shift();
    },
    checks: () => { checked = true; },
    confirm: async () => settings.workspaceId,
  });
  assert.equal(calls.length, 3);
  for (const args of calls) {
    assert.equal(args[args.indexOf('--workspace-id') + 1], settings.workspaceId);
    assert.equal(args[args.indexOf('--tenant') + 1], settings.tenantId);
    assert.ok(!args.includes('--yes') && !args.includes('--force') && !args.includes('--capacity-id'));
  }
  assert.ok(logs.some((message) => message.includes('https://scanner.example.invalid/discovery-redirect.html')));
  assert.ok(logs.some((message) => message.includes('not runtime scan behavior')));
  assert.ok(logs.some((message) => message.includes('Single-page application redirect URI')));
  assert.ok(logs.some((message) => message.includes('separate from app sign-in')));
  assert.ok(logs.some((message) => message.includes('test the actual Fabric view before sharing')));
});

test('a reachable but unauthorized management endpoint is not reported as a successful deployment check', async (t) => {
  const { root } = fixture(t);
  registry(root);
  const results = [
    preview(), { status: 'success', warnings: [], generate: [] },
    { endpointHealth: { reachable: true, authenticated: false, httpStatus: 401 } },
  ];
  await assert.rejects(deployScanner(settings, itemName, {
    projectRoot: root, log: () => {}, cli: () => results.shift(),
    checks: () => {}, confirm: async () => settings.workspaceId,
  }), /management health was not verified/);
});

test('callback instructions cannot come from another tenant or an unsafe hosting URL', (t) => {
  const { root } = fixture(t);
  for (const overrides of [
    { fabricTenantId: settings.clientId },
    { hostingUrl: 'http://scanner.example.invalid' },
    { hostingUrl: 'https://credential@scanner.example.invalid' },
    { hostingUrl: 'https://scanner.example.invalid/?token=do-not-register' },
  ]) {
    registry(root, overrides);
    assert.throws(() => readDeployment(root, settings, itemName));
  }
});
