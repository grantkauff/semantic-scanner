import {
  AuthError, BrowserAuthErrorCodes, InteractionRequiredAuthError, PublicClientApplication, type AccountInfo,
} from '@azure/msal-browser';
import axios from 'axios';
import type { InvokeHttpClient } from '@microsoft/rayfin-connectors';
import {
  executeDaxDirect, toQueryResult,
} from '@microsoft/rayfin-connector-fabric-semanticmodel';

import { aiInstructionsInventory, descriptionInventory } from '@/queries';
import { analyzeAIInstructions, type AIInstructionsCheck } from './ai-instructions';
import { analyzeDescriptions, type DescriptionScan } from './description-scan';

const fabricOrigin = 'https://api.fabric.microsoft.com';
const powerBiOrigin = 'https://api.powerbi.com';
const scopes = [
  'https://analysis.windows.net/powerbi/api/Workspace.Read.All',
  'https://analysis.windows.net/powerbi/api/Dataset.Read.All',
];

export interface SemanticModel {
  id: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
  descriptionStatus?: 'present' | 'missing';
}

export function modelKey(model: SemanticModel) {
  return `${model.workspaceId}:${model.id}`;
}

interface Workspace {
  id: string;
  name: string;
  personal: boolean;
}

export type WorkspaceInventory = Workspace & (
  | { status: 'ready'; models: SemanticModel[] }
  | { status: 'error'; error: string }
);

export interface DiscoveryClient {
  initialize(): Promise<void>;
  connect(restartPendingSignIn?: boolean): Promise<string>;
  discover(signal: AbortSignal, progress: (message: string) => void): Promise<WorkspaceInventory[]>;
  scan(model: SemanticModel, signal: AbortSignal): Promise<DescriptionScan>;
  scanAIInstructions(model: SemanticModel, signal: AbortSignal): Promise<AIInstructionsCheck>;
  disconnect(): Promise<void>;
}

export class FabricReadAccessError extends Error {}
export class FabricSignInTimeoutError extends FabricReadAccessError {}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function guid(value: unknown): value is string {
  return typeof value === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
}

function authError(error: unknown): Error {
  if (error instanceof InteractionRequiredAuthError) {
    return new FabricReadAccessError('Microsoft needs you to reconnect. Choose Connect workspaces and complete the read-access sign-in.');
  }
  if (error instanceof AuthError) {
    return new FabricReadAccessError(`Microsoft sign-in did not complete (${error.errorCode}). Allow the sign-in popup and try again. Your organization may require permission consent.`);
  }
  return error instanceof Error ? error : new Error('Microsoft sign-in did not complete. Try connecting again.');
}

export function discoveryError(error: unknown): string {
  return error instanceof Error ? error.message : 'The Fabric request failed. Check your connection and try again.';
}

class FabricDiscoveryClient implements DiscoveryClient {
  #auth: PublicClientApplication | undefined;
  #tenantId: string | undefined;
  #initialization: Promise<void> | undefined;
  #account: AccountInfo | undefined;
  #version = 0;
  #http = axios.create({
    adapter: 'fetch',
    timeout: 60_000,
    withCredentials: false,
    fetchOptions: { credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' },
    validateStatus: () => true,
  });

  initialize() {
    this.#initialization ??= this.#initialize();
    return this.#initialization;
  }

  async #initialize() {
    const tenantId = import.meta.env.VITE_SCANNER_TENANT_ID?.trim().toLowerCase();
    const clientId = import.meta.env.VITE_SCANNER_CLIENT_ID?.trim().toLowerCase();
    if (
      !guid(tenantId) || !guid(clientId) ||
      tenantId === '00000000-0000-0000-0000-000000000000' ||
      clientId === '00000000-0000-0000-0000-000000000000'
    ) {
      throw new FabricReadAccessError('Workspace sign-in needs setup. Ask the app owner to run npm run setup with their tenant and Entra SPA client IDs, then rebuild and deploy the app.');
    }
    const auth = new PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri: new URL('/discovery-redirect.html', window.location.origin).href,
      },
      cache: { cacheLocation: 'memoryStorage' },
    });
    await auth.initialize();
    this.#tenantId = tenantId;
    this.#auth = auth;
  }

  async connect(restartPendingSignIn = false) {
    const auth = this.#auth;
    if (!auth) throw new FabricReadAccessError('Workspace sign-in is not ready. Complete app setup, then reload.');
    const version = ++this.#version;
    const previous = this.#account;
    this.#account = undefined;
    try {
      const result = await auth.acquireTokenPopup({
        scopes, prompt: 'select_account', overrideInteractionInProgress: restartPendingSignIn,
      });
      if (version !== this.#version) throw new FabricReadAccessError('The source connection changed. Connect workspaces again.');
      if (!result.account || result.tenantId.toLowerCase() !== this.#tenantId) {
        throw new FabricReadAccessError("Sign in to a Microsoft account in this app's tenant to discover its workspaces.");
      }
      if (previous && previous.homeAccountId !== result.account.homeAccountId) {
        await auth.clearCache({ account: previous });
        if (version !== this.#version) throw new FabricReadAccessError('The source connection changed. Connect workspaces again.');
      }
      this.#account = result.account;
      return result.account.username || result.account.name || result.account.localAccountId;
    } catch (error) {
      if (error instanceof AuthError) {
        switch (error.errorCode) {
          case BrowserAuthErrorCodes.interactionInProgress:
            throw new FabricReadAccessError('A previous Microsoft sign-in is still pending. If you closed its popup, choose Reopen sign-in on Workspaces & models.');
          case BrowserAuthErrorCodes.userCancelled:
          case BrowserAuthErrorCodes.interactionInProgressCancelled:
            throw new FabricReadAccessError('Microsoft sign-in was cancelled. Choose Reopen sign-in on Workspaces & models to try again.');
          case BrowserAuthErrorCodes.timedOut:
            throw new FabricSignInTimeoutError('Microsoft sign-in timed out. Choose Reopen sign-in on Workspaces & models and complete the popup.');
          case BrowserAuthErrorCodes.popupWindowError:
          case BrowserAuthErrorCodes.emptyWindowError:
            throw new FabricReadAccessError('The Microsoft sign-in popup could not open. Allow popups for this app, then choose Reopen sign-in on Workspaces & models.');
        }
      }
      throw authError(error);
    }
  }

  async #token() {
    const auth = this.#auth;
    const account = this.#account;
    const version = this.#version;
    if (!auth || !account) throw new FabricReadAccessError('Connect workspaces before reading Fabric metadata.');
    try {
      const result = await auth.acquireTokenSilent({ account, scopes });
      if (
        version !== this.#version || !result.accessToken ||
        result.account?.homeAccountId !== account.homeAccountId ||
        result.tenantId.toLowerCase() !== this.#tenantId
      ) {
        throw new FabricReadAccessError('The Microsoft source account changed. Connect workspaces again.');
      }
      return result.accessToken;
    } catch (error) {
      throw authError(error);
    }
  }

  async #request(input: Request | string | URL, init: RequestInit | undefined, signal: AbortSignal) {
    const version = this.#version;
    signal.throwIfAborted();
    const request = new Request(input, init);
    const url = new URL(request.url);
    const catalogRead = url.origin === fabricOrigin && request.method === 'GET';
    const metadataRead = url.origin === powerBiOrigin && request.method === 'POST' &&
      /^\/v1\.0\/myorg\/datasets\/[\da-f-]+\/executeDaxQueries$/i.test(url.pathname);
    if ((!catalogRead && !metadataRead) || url.username || url.password || url.hash) {
      throw new Error('The metadata request did not target an approved Microsoft read endpoint.');
    }
    const token = await this.#token();
    signal.throwIfAborted();
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const response = await this.#http.request<ArrayBuffer>({
      url: url.href,
      method: request.method,
      headers: Object.fromEntries(headers),
      data: request.method === 'GET' ? undefined : await request.text(),
      responseType: 'arraybuffer',
      signal: AbortSignal.any([signal, request.signal]),
    });
    signal.throwIfAborted();
    if (version !== this.#version) throw new FabricReadAccessError('The source account changed. Connect workspaces again.');
    if (response.status === 401) {
      throw new FabricReadAccessError('Microsoft rejected the read-access session. Connect workspaces again; ask your administrator to check consent if it persists.');
    }
    const responseHeaders = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (typeof value === 'string') responseHeaders.set(name, value);
    }
    return new Response(response.status === 204 ? null : response.data, {
      status: response.status, headers: responseHeaders,
    });
  }

  async #pages(path: string, signal: AbortSignal): Promise<Record<string, unknown>[]> {
    const initial = new URL(path, fabricOrigin);
    let next: URL | undefined = initial;
    const seen = new Set<string>();
    const identities = new Set<string>();
    const items: Record<string, unknown>[] = [];
    while (next) {
      if (seen.has(next.href)) throw new Error('Fabric repeated a catalog page. Refresh the workspace inventory; this listing is incomplete.');
      seen.add(next.href);
      const response = await this.#request(next, undefined, signal);
      if (!response.ok) {
        const hint = response.status === 403 ? 'Check your workspace access.' :
          response.status === 429 ? 'Fabric is throttling discovery. Wait before refreshing.' :
            'Check Fabric availability and try refreshing.';
        throw new Error(`Could not list Fabric metadata (HTTP ${response.status}). ${hint}`);
      }
      const page: unknown = await response.json();
      if (!record(page) || !Array.isArray(page.value)) {
        throw new Error('Fabric returned an unexpected catalog response. This listing is incomplete.');
      }
      for (const item of page.value) {
        if (!record(item) || !guid(item.id) || !text(item.displayName) || identities.has(item.id.toLowerCase())) {
          throw new Error('Fabric returned invalid or duplicate catalog entries. Refresh the inventory.');
        }
        identities.add(item.id.toLowerCase());
        items.push(item);
      }
      next = undefined;
      if (page.continuationToken != null || page.continuationUri != null) {
        if (!text(page.continuationToken) || !text(page.continuationUri)) {
          throw new Error('Fabric did not supply a usable next-page link. This listing is incomplete.');
        }
        const link = new URL(page.continuationUri);
        if (
          link.origin !== fabricOrigin || link.pathname !== initial.pathname ||
          link.username || link.password || link.hash || !link.searchParams.has('continuationToken') ||
          [...link.searchParams.keys()].some((key) => key !== 'continuationToken' && !initial.searchParams.has(key))
        ) {
          throw new Error('Fabric supplied an unexpected next-page link. It was not followed.');
        }
        for (const [key, value] of initial.searchParams) {
          const supplied = link.searchParams.get(key);
          if (supplied !== null && supplied !== value) throw new Error('Fabric changed the catalog filter between pages.');
          if (supplied === null) link.searchParams.set(key, value);
        }
        next = link;
      }
    }
    return items;
  }

  async discover(signal: AbortSignal, progress: (message: string) => void) {
    progress('Listing accessible workspaces...');
    const items = await this.#pages('/v1/workspaces', signal);
    const workspaces: Workspace[] = items.map((item) => {
      if (!guid(item.id) || !text(item.displayName) || !text(item.type)) {
        throw new Error('Fabric returned invalid workspace metadata.');
      }
      return { id: item.id, name: item.displayName, personal: item.type === 'Personal' };
    });
    const inventory: WorkspaceInventory[] = [];
    for (const [index, workspace] of workspaces.entries()) {
      signal.throwIfAborted();
      progress(`Discovering models: ${index + 1} of ${workspaces.length} workspaces (${workspace.name})...`);
      try {
        const entries = await this.#pages(`/v1/workspaces/${workspace.id}/items?type=SemanticModel`, signal);
        const models: SemanticModel[] = entries.map((item) => {
          if (
            !guid(item.id) || !text(item.displayName) || item.type !== 'SemanticModel' ||
            typeof item.workspaceId !== 'string' || item.workspaceId.toLowerCase() !== workspace.id.toLowerCase() ||
            (item.description !== undefined && item.description !== null && typeof item.description !== 'string')
          ) throw new Error('Fabric returned invalid semantic-model metadata.');
          const descriptionStatus: SemanticModel['descriptionStatus'] = item.description === undefined
            ? undefined : text(item.description) ? 'present' : 'missing';
          return {
            id: item.id, name: item.displayName, workspaceId: workspace.id, workspaceName: workspace.name,
            ...(descriptionStatus === undefined ? {} : { descriptionStatus }),
          };
        });
        inventory.push({ ...workspace, status: 'ready', models });
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof FabricReadAccessError) throw error;
        inventory.push({ ...workspace, status: 'error', error: discoveryError(error) });
      }
    }
    return inventory.sort((a, b) => a.name.localeCompare(b.name));
  }

  async #query(model: SemanticModel, query: string, queryTimeout: number, resultSetRowCountLimit: number, signal: AbortSignal) {
    if (!guid(model.id) || !guid(model.workspaceId)) throw new Error('The selected model has an invalid source identifier.');
    let authenticationError: FabricReadAccessError | undefined;
    const http: InvokeHttpClient = {
      fetch: async (input, init) => {
        try {
          return await this.#request(input, init, signal);
        } catch (error) {
          if (error instanceof FabricReadAccessError) authenticationError = error;
          throw error;
        }
      },
    };
    const response = await executeDaxDirect(
      http, { workspaceId: model.workspaceId, itemId: model.id }, query,
      { queryTimeout, resultSetRowCountLimit },
    );
    signal.throwIfAborted();
    if (authenticationError) throw authenticationError;
    const result = toQueryResult(response);
    if (result.status === 'error') {
      throw new Error([result.error.message, result.error.recoveryHint].filter(Boolean).join(' '));
    }
    return result.table;
  }

  async scan(model: SemanticModel, signal: AbortSignal) {
    return analyzeDescriptions(await this.#query(model, descriptionInventory().query, 30, 2_001, signal));
  }

  async scanAIInstructions(model: SemanticModel, signal: AbortSignal) {
    const input = aiInstructionsInventory();
    return analyzeAIInstructions(await this.#query(model, input.query, input.queryTimeout, input.resultSetRowCountLimit, signal));
  }

  async disconnect() {
    ++this.#version;
    this.#account = undefined;
    if (this.#auth) await this.#auth.clearCache();
  }
}

export function createDiscoveryClient(): DiscoveryClient {
  return new FabricDiscoveryClient();
}
