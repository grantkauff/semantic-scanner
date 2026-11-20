import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError, PublicClientApplication } from '@azure/msal-browser';

import { createDiscoveryClient, FabricReadAccessError, FabricSignInTimeoutError } from './fabric-discovery';

const { auth, request, execute, normalize, state } = vi.hoisted(() => ({
  auth: {
    initialize: vi.fn(), acquireTokenPopup: vi.fn(), acquireTokenSilent: vi.fn(), clearCache: vi.fn(),
  },
  request: vi.fn(),
  execute: vi.fn(),
  normalize: vi.fn(),
  state: { tenant: '' },
}));
vi.mock('@azure/msal-browser', async (importOriginal) => ({
  ...await importOriginal<typeof import('@azure/msal-browser')>(),
  PublicClientApplication: vi.fn(function (config: { auth: { authority: string } }) {
    state.tenant = config.auth.authority.split('/').at(-1) ?? '';
    return auth;
  }),
}));
vi.mock('axios', () => ({ default: { create: () => ({ request }) } }));
vi.mock('@microsoft/rayfin-connector-fabric-semanticmodel', async (importOriginal) => ({
  ...await importOriginal<typeof import('@microsoft/rayfin-connector-fabric-semanticmodel')>(),
  executeDaxDirect: execute,
  toQueryResult: normalize,
}));

const workspaceId = '11111111-1111-4111-8111-111111111111';
const secondWorkspaceId = '22222222-2222-4222-8222-222222222222';
const modelId = '33333333-3333-4333-8333-333333333333';
const secondModelId = '44444444-4444-4444-8444-444444444444';
const workspace = { id: workspaceId, displayName: 'Personal', type: 'Personal' };
const secondWorkspace = { id: secondWorkspaceId, displayName: 'Team', type: 'Workspace' };
const model = { id: modelId, displayName: 'First', type: 'SemanticModel', workspaceId };
const secondModel = { ...model, id: secondModelId, displayName: 'Second' };
const target = { id: modelId, name: 'First', workspaceId, workspaceName: 'Personal' };
const account = {
  homeAccountId: 'account-a', localAccountId: 'local-a',
  username: 'scanner@example.invalid', environment: 'login.microsoftonline.com', tenantId: 'test-tenant',
};
const signal = () => new AbortController().signal;

function reply(body: unknown, status = 200) {
  return {
    status, headers: { 'content-type': 'application/json' },
    data: new TextEncoder().encode(JSON.stringify(body)).buffer,
  };
}

async function connected() {
  const client = createDiscoveryClient();
  await client.initialize();
  await client.connect();
  return client;
}

describe('delegated Fabric discovery', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SCANNER_TENANT_ID', '55555555-5555-4555-8555-555555555555');
    vi.stubEnv('VITE_SCANNER_CLIENT_ID', '66666666-6666-4666-8666-666666666666');
    vi.mocked(PublicClientApplication).mockClear();
    for (const mock of Object.values(auth)) mock.mockReset();
    request.mockReset();
    execute.mockReset().mockResolvedValue({});
    normalize.mockReset();
    auth.initialize.mockResolvedValue(undefined);
    auth.clearCache.mockResolvedValue(undefined);
    auth.acquireTokenPopup.mockImplementation(async () => ({ account, tenantId: state.tenant }));
    auth.acquireTokenSilent.mockImplementation(async () => ({
      account, tenantId: state.tenant, accessToken: 'delegated-test-token',
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses the installation tenant and secretless SPA without persisting source tokens', async () => {
    vi.stubEnv('VITE_SCANNER_TENANT_ID', ' AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA ');
    vi.stubEnv('VITE_SCANNER_CLIENT_ID', ' BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB ');
    await connected();
    expect(PublicClientApplication).toHaveBeenCalledWith({
      auth: {
        clientId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        authority: 'https://login.microsoftonline.com/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        redirectUri: new URL('/discovery-redirect.html', window.location.origin).href,
      },
      cache: { cacheLocation: 'memoryStorage' },
    });
  });

  it.each([
    ['VITE_SCANNER_TENANT_ID', ''],
    ['VITE_SCANNER_TENANT_ID', 'organizations'],
    ['VITE_SCANNER_CLIENT_ID', 'invalid-client'],
    ['VITE_SCANNER_CLIENT_ID', '00000000-0000-0000-0000-000000000000'],
  ])('surfaces invalid %s configuration before creating an auth client or sending requests', async (key, value) => {
    vi.stubEnv(key, value);
    const client = createDiscoveryClient();
    await expect(client.initialize()).rejects.toThrow('npm run setup');
    await expect(client.disconnect()).resolves.toBeUndefined();
    expect(PublicClientApplication).not.toHaveBeenCalled();
    expect(auth.acquireTokenPopup).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a source sign-in from another tenant before any catalog request', async () => {
    auth.acquireTokenPopup.mockResolvedValueOnce({
      account, tenantId: '77777777-7777-4777-8777-777777777777',
    });
    const client = createDiscoveryClient();
    await client.initialize();
    await expect(client.connect()).rejects.toThrow("this app's tenant");
    expect(request).not.toHaveBeenCalled();
  });

  it('only replaces a pending Microsoft interaction after an explicit sign-in retry', async () => {
    auth.acquireTokenPopup.mockRejectedValueOnce(new AuthError('interaction_in_progress', 'Test pending sign-in.'));
    const client = createDiscoveryClient();
    await client.initialize();
    await expect(client.connect()).rejects.toThrow('Reopen sign-in');
    expect(auth.acquireTokenPopup).toHaveBeenCalledOnce();
    expect(auth.acquireTokenPopup.mock.calls[0][0]).toMatchObject({
      prompt: 'select_account', overrideInteractionInProgress: false,
    });

    await expect(client.connect(true)).resolves.toBe(account.username);
    expect(auth.acquireTokenPopup).toHaveBeenCalledTimes(2);
    expect(auth.acquireTokenPopup.mock.calls[1][0]).toMatchObject({
      prompt: 'select_account', overrideInteractionInProgress: true,
    });
  });

  it.each([
    ['user_cancelled', 'Microsoft sign-in was cancelled.'],
    ['timed_out', 'Microsoft sign-in timed out.'],
    ['popup_window_error', 'Allow popups for this app'],
  ])('explains how to retry a %s popup without silently retrying authentication', async (code, message) => {
    auth.acquireTokenPopup.mockRejectedValueOnce(new AuthError(code, 'Test popup failure.'));
    const client = createDiscoveryClient();
    await client.initialize();
    const connection = client.connect();
    await expect(connection).rejects.toThrow(message);
    if (code === 'timed_out') {
      await expect(connection).rejects.toBeInstanceOf(FabricSignInTimeoutError);
    } else {
      await expect(connection).rejects.not.toBeInstanceOf(FabricSignInTimeoutError);
    }
    expect(auth.acquireTokenPopup).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a superseded popup success rather than replacing the retried source account', async () => {
    let finishPrevious!: (result: { account: typeof account; tenantId: string }) => void;
    auth.acquireTokenPopup.mockImplementationOnce(() => new Promise((resolve) => { finishPrevious = resolve; }));
    const nextAccount = { ...account, homeAccountId: 'account-b', username: 'other@example.invalid' };
    const client = createDiscoveryClient();
    await client.initialize();
    const previous = expect(client.connect()).rejects.toThrow('source connection changed');
    auth.acquireTokenPopup.mockResolvedValueOnce({ account: nextAccount, tenantId: state.tenant });
    await expect(client.connect(true)).resolves.toBe(nextAccount.username);
    finishPrevious({ account, tenantId: state.tenant });
    await previous;

    auth.acquireTokenSilent.mockResolvedValueOnce({
      account: nextAccount, tenantId: state.tenant, accessToken: 'retried-test-token',
    });
    request.mockResolvedValueOnce(reply({ value: [] }));
    await client.discover(signal(), vi.fn());
    expect(auth.acquireTokenSilent).toHaveBeenCalledWith(expect.objectContaining({ account: nextAccount }));
  });

  it('follows all workspace and model pages, preserving opaque continuation links and personal workspace identity', async () => {
    const workspaceNext = 'https://api.fabric.microsoft.com/v1/workspaces?continuationToken=opaque%2Btoken%3D';
    const modelNext = `https://api.fabric.microsoft.com/v1/workspaces/${workspaceId}/items?type=SemanticModel&continuationToken=model%2Btoken%3D`;
    request
      .mockResolvedValueOnce(reply({ value: [workspace], continuationToken: 'opaque+token=', continuationUri: workspaceNext }))
      .mockResolvedValueOnce(reply({ value: [secondWorkspace] }))
      .mockResolvedValueOnce(reply({ value: [model], continuationToken: 'model+token=', continuationUri: modelNext }))
      .mockResolvedValueOnce(reply({ value: [secondModel] }))
      .mockResolvedValueOnce(reply({ value: [] }));
    const client = await connected();
    const inventory = await client.discover(signal(), vi.fn());
    expect(inventory).toEqual([
      { id: workspaceId, name: 'Personal', personal: true, status: 'ready', models: [
        target, { ...target, id: secondModelId, name: 'Second' },
      ] },
      { id: secondWorkspaceId, name: 'Team', personal: false, status: 'ready', models: [] },
    ]);
    expect(request.mock.calls.map(([options]) => options.url)).toContain(workspaceNext);
    expect(request.mock.calls.map(([options]) => options.url)).toContain(modelNext);
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses an untrusted pagination URL before sending it a delegated token', async () => {
    request.mockResolvedValueOnce(reply({
      value: [workspace], continuationToken: 'next',
      continuationUri: 'https://untrusted.invalid/v1/workspaces?continuationToken=next',
    }));
    const client = await connected();
    await expect(client.discover(signal(), vi.fn())).rejects.toThrow('unexpected next-page link');
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([
    ['Model context', 'present'],
    [' \t ', 'missing'],
    [null, 'missing'],
    [undefined, undefined],
  ] as const)('retains catalog description presence without treating an unreturned property as missing (%s)', async (description, expected) => {
    request
      .mockResolvedValueOnce(reply({ value: [workspace] }))
      .mockResolvedValueOnce(reply({ value: [{ ...model, description }] }));
    const client = await connected();
    const inventory = await client.discover(signal(), vi.fn());
    const entry = inventory[0];
    expect(entry.status).toBe('ready');
    if (entry.status !== 'ready') throw new Error('Expected model inventory.');
    expect(entry.models[0].descriptionStatus).toBe(expected);
    expect(entry.models[0]).not.toHaveProperty('description');
  });

  it('rejects a malformed catalog description instead of calling it a missing description', async () => {
    request
      .mockResolvedValueOnce(reply({ value: [workspace] }))
      .mockResolvedValueOnce(reply({ value: [{ ...model, description: 12 }] }));
    const client = await connected();
    const inventory = await client.discover(signal(), vi.fn());
    expect(inventory[0]).toMatchObject({ status: 'error', error: 'Fabric returned invalid semantic-model metadata.' });
  });

  it('keeps same-named models paired with their own workspace labels and execution targets', async () => {
    request
      .mockResolvedValueOnce(reply({ value: [
        { ...workspace, displayName: 'test' },
        { ...secondWorkspace, displayName: 'Production' },
      ] }))
      .mockResolvedValueOnce(reply({ value: [{ ...model, displayName: 'Shared' }] }))
      .mockResolvedValueOnce(reply({ value: [{
        ...secondModel, displayName: 'Shared', workspaceId: secondWorkspaceId,
      }] }));
    const client = await connected();
    const inventory = await client.discover(signal(), vi.fn());
    const models = inventory.flatMap((entry) => entry.status === 'ready' ? entry.models : []);
    expect(models).toEqual(expect.arrayContaining([
      { ...target, name: 'Shared', workspaceName: 'test' },
      { id: secondModelId, name: 'Shared', workspaceId: secondWorkspaceId, workspaceName: 'Production' },
    ]));
    execute.mockRejectedValue(new Error('Execution target inspected.'));
    for (const entry of models) {
      await expect(client.scan(entry, signal())).rejects.toThrow('Execution target inspected.');
    }
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map(([, executionTarget]) => executionTarget)).toEqual(expect.arrayContaining([
      { workspaceId, itemId: modelId },
      { workspaceId: secondWorkspaceId, itemId: secondModelId },
    ]));
  });

  it('keeps individual workspace failures explicit while continuing discovery in other workspaces', async () => {
    request
      .mockResolvedValueOnce(reply({ value: [workspace, secondWorkspace] }))
      .mockResolvedValueOnce(reply({}, 403))
      .mockResolvedValueOnce(reply({ value: [] }));
    const client = await connected();
    const inventory = await client.discover(signal(), vi.fn());
    expect(inventory[0]).toMatchObject({ status: 'error', error: expect.stringContaining('403') });
    expect(inventory[0]).not.toHaveProperty('models');
    expect(inventory[1]).toMatchObject({ status: 'ready', models: [] });
  });

  it('rejects malformed or duplicate catalog entries rather than presenting a complete inventory', async () => {
    request.mockResolvedValueOnce(reply({ value: [workspace, workspace] }));
    const client = await connected();
    await expect(client.discover(signal(), vi.fn())).rejects.toThrow('invalid or duplicate');
    expect(request).toHaveBeenCalledOnce();
  });

  it('does not continue using a different cached Microsoft account', async () => {
    const client = await connected();
    auth.acquireTokenSilent.mockResolvedValueOnce({
      account: { ...account, homeAccountId: 'account-b' }, tenantId: state.tenant, accessToken: 'other-test-token',
    });
    await expect(client.discover(signal(), vi.fn())).rejects.toBeInstanceOf(FabricReadAccessError);
    expect(request).not.toHaveBeenCalled();
  });

  it('forgets the previous account credentials after an explicit source-account switch', async () => {
    const client = await connected();
    auth.acquireTokenPopup.mockResolvedValueOnce({
      account: { ...account, homeAccountId: 'account-b' }, tenantId: state.tenant,
    });
    await client.connect();
    expect(auth.clearCache).toHaveBeenCalledWith({ account });
  });

  it('stops discovery on authentication rejection instead of returning empty workspaces', async () => {
    request
      .mockResolvedValueOnce(reply({ value: [workspace, secondWorkspace] }))
      .mockResolvedValueOnce(reply({}, 401));
    const client = await connected();
    await expect(client.discover(signal(), vi.fn())).rejects.toBeInstanceOf(FabricReadAccessError);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each(['thrown', 'returned'])('propagates a %s metadata execution failure without generating findings', async (channel) => {
    if (channel === 'thrown') execute.mockRejectedValueOnce(new Error('Metadata execution unavailable.'));
    else normalize.mockReturnValueOnce({
      status: 'error', error: { message: 'Metadata execution unavailable.' },
    });
    const client = await connected();
    await expect(client.scan(target, signal())).rejects.toThrow('Metadata execution unavailable.');
    expect(execute.mock.calls[0][1]).toEqual({ workspaceId, itemId: modelId });
  });

  it('rejects an incomplete per-model metadata response after dynamic execution', async () => {
    normalize.mockReturnValueOnce({
      status: 'success',
      table: {
        columns: [
          '[ObjectType]', '[TableName]', '[ObjectName]', '[Description]', '[IsHidden]', '[ExpectedObjectCount]',
        ].map((name) => ({ name, dataType: 'String' })),
        rows: [['Table', 'Fleet', 'Fleet', null, false, 2]],
      },
    });
    const client = await connected();
    await expect(client.scan(target, signal())).rejects.toThrow('incomplete');
  });

  it('uses the selected model and bounded read-only query for AI-instruction inspection', async () => {
    normalize.mockReturnValueOnce({
      status: 'success',
      table: {
        columns: ['[CultureId]', '[Content]', '[ContentLength]', '[ExpectedMetadataCount]']
          .map((name) => ({ name, dataType: 'unknown' })),
        rows: [[null, null, null, 0]],
      },
    });
    const client = await connected();
    await expect(client.scanAIInstructions(target, signal())).resolves.toMatchObject({ status: 'review' });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0].slice(1)).toEqual([
      { workspaceId, itemId: modelId }, expect.stringContaining('INFO.LINGUISTICMETADATA()'),
      { queryTimeout: 20, resultSetRowCountLimit: 18 },
    ]);
  });

  it('propagates instruction permission errors without converting them into missing settings', async () => {
    normalize.mockReturnValueOnce({ status: 'error', error: { message: 'Linguistic metadata permission required.' } });
    const client = await connected();
    await expect(client.scanAIInstructions(target, signal())).rejects.toThrow('Linguistic metadata permission required.');
  });

  describe('DAX HTTP authentication', () => {
    beforeEach(async () => {
      const sdk = await vi.importActual<typeof import('@microsoft/rayfin-connector-fabric-semanticmodel')>(
        '@microsoft/rayfin-connector-fabric-semanticmodel',
      );
      execute.mockImplementation(sdk.executeDaxDirect);
      vi.stubGlobal('fetch', vi.fn(() => {
        throw new Error('DAX tests must use the injected HTTP transport, not native network access.');
      }));
    });

    it('preserves a reconnect error when the real SDK envelopes an HTTP 401', async () => {
      request.mockResolvedValueOnce(reply({}, 401));
      const client = await connected();

      await expect(client.scan(target, signal())).rejects.toBeInstanceOf(FabricReadAccessError);

      expect(request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        method: 'POST',
        url: `https://api.powerbi.com/v1.0/myorg/datasets/${modelId}/executeDaxQueries`,
        headers: expect.objectContaining({ authorization: 'Bearer delegated-test-token' }),
      }));
      expect(normalize).not.toHaveBeenCalled();
    });

    it('rejects an in-flight DAX response after the source account changes', async () => {
      let finishRequest!: (response: ReturnType<typeof reply>) => void;
      request.mockImplementationOnce(() => new Promise((resolve) => { finishRequest = resolve; }));
      const client = await connected();
      const pending = expect(client.scan(target, signal())).rejects.toBeInstanceOf(FabricReadAccessError);
      await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());

      auth.acquireTokenPopup.mockResolvedValueOnce({
        account: { ...account, homeAccountId: 'account-b', username: 'other@example.invalid' },
        tenantId: state.tenant,
      });
      await client.connect();
      finishRequest(reply({}));

      await pending;
      expect(normalize).not.toHaveBeenCalled();
    });
  });
});
