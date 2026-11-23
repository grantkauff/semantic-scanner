//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { lazy, Suspense, useId, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import {
  BarChart3, BookOpen, ExternalLink, FolderOpen, Layers3, LoaderCircle, LockKeyhole, LogOut, Moon, ScanLine, Search, Sun,
} from 'lucide-react';
import { useWorkspaceScanner, type ModelScanResult } from './hooks/use-workspace-scanner';
import { useTheme } from './hooks/theme.context';
import type { DescriptionScan } from './lib/description-scan';
import { modelKey, type SemanticModel, type WorkspaceInventory } from './lib/fabric-discovery';
import { getRayfinClient } from './lib/rayfin-client';

const ReadinessOverview = lazy(() => import('./components/readiness-overview'));

function ScanError({ message, hint }: { message: string; hint?: string }) {
  return (
    <section role="alert" className="rounded-2xl border border-border bg-warning p-600 text-warning-foreground">
      <h3 className="font-heading text-500 leading-500">Couldn't read model metadata</h3>
      <p className="mt-300 wrap-anywhere">{message}</p>
      <p className="mt-300">{hint ?? 'Check the model connection and your Read and Build permissions before trying again. No findings have been reported.'}</p>
    </section>
  );
}

function DescriptionResults({ scan }: { scan: DescriptionScan }) {
  const summaryId = useId();
  const missingId = useId();
  if (scan.acquired === 0) {
    return (
      <section role="status" className="rounded-2xl border border-border bg-card p-600">
        <h3 className="font-heading text-500 leading-500">No metadata returned</h3>
        <p className="mt-300 text-muted-foreground">This does not prove that the model is empty. Check source access before interpreting the result.</p>
      </section>
    );
  }

  return (
    <div className="space-y-600">
      <section aria-labelledby={summaryId} className="overflow-hidden rounded-2xl border border-border bg-card">
        <div role="status" className="border-b border-border p-600">
          <p className="text-200 font-semibold uppercase tracking-widest text-primary">Description presence</p>
          <h3 id={summaryId} className="mt-200 font-heading text-600 leading-600">
            {scan.missing.length === 0 ? 'No missing descriptions in scope' : `${scan.missing.length} objects need descriptions`}
          </h3>
          <p className="mt-300 text-muted-foreground">
            {scan.acquired} metadata objects read. {scan.excludedHidden} hidden objects or objects in hidden tables excluded.
          </p>
        </div>
        <table className="w-full text-left">
          <caption className="sr-only">Descriptions by object type</caption>
          <thead className="bg-muted text-200 text-muted-foreground">
            <tr><th scope="col" className="p-400">Object type</th><th scope="col" className="p-400">Described</th><th scope="col" className="p-400">Missing</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {scan.summary.map((group) => (
              <tr key={group.kind}>
                <th scope="row" className="p-400 font-medium">{group.kind}s</th>
                <td className="p-400">{group.total === 0 ? 'None returned in scope' : `${group.documented} of ${group.total}`}</td>
                <td className="p-400 font-numeric">{group.total === 0 ? '-' : group.total - group.documented}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-border p-400 text-200 leading-300 text-muted-foreground">
          Only non-hidden objects in non-hidden tables are checked. These are the metadata returned to your account, not a full-model or AI-readiness certification.
        </p>
      </section>
      <section className="overflow-hidden rounded-2xl border border-border bg-card" aria-labelledby={missingId}>
        <div className="border-b border-border p-600">
          <h3 id={missingId} className="font-heading text-500 leading-500">Missing descriptions</h3>
          <p className="mt-200 text-muted-foreground">Add descriptions in your model authoring tool, then scan again. This app never writes changes.</p>
        </div>
        {scan.missing.length === 0 ? (
          <p className="p-600 text-muted-foreground">No blank or whitespace-only descriptions were found among the objects in scope.</p>
        ) : (
          <table className="w-full table-fixed text-left">
            <caption className="sr-only">Objects with missing descriptions</caption>
            <thead className="bg-muted text-200 text-muted-foreground">
              <tr><th scope="col" className="p-400">Type</th><th scope="col" className="p-400">Table</th><th scope="col" className="p-400">Object</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {scan.missing.map((object) => (
                <tr key={object.id}>
                  <td className="p-400 align-top">{object.kind}</td>
                  <td className="wrap-anywhere p-400 align-top">{object.tableName}</td>
                  <th scope="row" className="wrap-anywhere p-400 align-top font-medium">{object.name}</th>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function modelStatus(result: ModelScanResult | undefined) {
  if (!result) return 'Not scanned';
  switch (result.status) {
    case 'pending': return 'Waiting';
    case 'reading': return 'Reading metadata';
    case 'cancelled': return 'Not scanned / stopped';
    case 'error': return 'Scan failed';
    case 'success': return result.scan.acquired === 0 ? 'No metadata returned' : `${result.scan.missing.length} missing descriptions`;
  }
}

function ModelResult({ result, autoExpand }: { result: ModelScanResult; autoExpand: boolean }) {
  const [expanded, setExpanded] = useState(autoExpand);
  return (
    <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)} className="rounded-2xl border border-border bg-card">
      <summary className="min-h-control cursor-pointer wrap-anywhere p-500 font-semibold">Model: {result.model.name} / {modelStatus(result)}</summary>
      {expanded && (
        <div className="space-y-400 border-t border-border p-400 md:p-600">
          {result.status === 'error' && <ScanError message={result.error} />}
          {result.status === 'success' && <DescriptionResults scan={result.scan} />}
          {(result.status === 'reading' || result.status === 'pending' || result.status === 'cancelled') && <p className="text-muted-foreground">{modelStatus(result)}. No findings have been reported for this model.</p>}
        </div>
      )}
    </details>
  );
}

export default function App() {
  const scanner = useWorkspaceScanner();
  const [tab, setTab] = useState('workspaces');
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [workspaceIds, setWorkspaceIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const { isDark, toggleTheme } = useTheme();
  const isEmbedded = window.parent !== window;
  const workspaces = scanner.catalog ?? [];
  const models = workspaces.flatMap((workspace) => workspace.status === 'ready' ? workspace.models : []);
  const scopedModels = models.filter((model) => scope === 'all' || workspaceIds.has(model.workspaceId));
  const selectedModels = scopedModels.filter((model) => selectedIds.has(modelKey(model)));
  const selectedWorkspaceCount = new Set(selectedModels.map((model) => model.workspaceId)).size;
  const matchesSearch = (model: SemanticModel) =>
    `${model.workspaceName} ${model.name}`.toLowerCase().includes(search.trim().toLowerCase());
  const visibleModels = scopedModels.filter(matchesSearch);
  const hiddenSelections = selectedModels.filter((model) => !matchesSearch(model)).length;
  const allSelected = scopedModels.length > 0 && selectedModels.length === scopedModels.length;
  const busy = scanner.phase !== null;
  const connecting = scanner.phase === 'connecting';
  const canReopenSignIn = scanner.ready && !scanner.account && (connecting || scanner.error !== null);
  const failures = workspaces.filter((workspace) => workspace.status === 'error');
  const resultByModel = new Map(scanner.results.map((result) => [modelKey(result.model), result]));
  const completed = scanner.results.filter((result) => result.status === 'success' && result.scan.acquired > 0).length;
  const failed = scanner.results.filter((result) => result.status === 'error').length;
  const empty = scanner.results.filter((result) => result.status === 'success' && result.scan.acquired === 0).length;

  async function loadInventory(reconnect: boolean, restartPendingSignIn = false) {
    if (reconnect) {
      setWorkspaceIds(new Set());
      setSelectedIds(new Set());
      setScope('all');
      setSearch('');
    }
    const inventory = await (reconnect ? scanner.connect(restartPendingSignIn) : scanner.refresh());
    if (!inventory) return;
    const discovered = inventory.flatMap((workspace) => workspace.status === 'ready' ? workspace.models : []);
    setWorkspaceIds(new Set(inventory.filter((workspace) => reconnect || scope === 'all' || workspaceIds.has(workspace.id)).map((workspace) => workspace.id)));
    setSelectedIds(new Set(discovered.filter((model) => reconnect || selectedIds.has(modelKey(model))).map(modelKey)));
  }

  function chooseScope(next: 'all' | 'selected') {
    setScope(next);
    scanner.clearResults();
    if (next === 'all') {
      setWorkspaceIds(new Set(workspaces.map((workspace) => workspace.id)));
      setSelectedIds(new Set(models.map(modelKey)));
    }
  }

  function chooseModels(targets: SemanticModel[], selected: boolean) {
    scanner.clearResults();
    setSelectedIds((previous) => {
      const next = new Set(previous);
      for (const model of targets) {
        if (selected) next.add(modelKey(model));
        else next.delete(modelKey(model));
      }
      return next;
    });
  }

  function chooseWorkspace(workspace: WorkspaceInventory, selected: boolean) {
    setWorkspaceIds((previous) => {
      const next = new Set(previous);
      if (selected) next.add(workspace.id);
      else next.delete(workspace.id);
      return next;
    });
    chooseModels(workspace.status === 'ready' ? workspace.models : [], selected);
  }

  async function signOut() {
    setSignOutError(null);
    try {
      const client = await getRayfinClient();
      await client.auth.signOut();
    } catch (error) {
      setSignOutError(`Sign-out failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <a href="#scanner-content" className="sr-only z-50 rounded-lg bg-primary p-300 text-primary-foreground focus:not-sr-only focus:fixed focus:top-300 focus:left-300">Skip to content</a>
      <header className="border-b border-border bg-card px-500 py-400 md:px-800">
        <div className="mx-auto flex max-w-content items-center justify-between gap-400">
          <div className="flex items-center gap-300">
            <ScanLine aria-hidden="true" className="icon-size-500 text-primary" />
            <p className="font-heading text-500 leading-500">semantic scanner</p>
          </div>
          <div className="flex items-center gap-300">
            <button type="button" aria-label={isDark ? 'Use light theme' : 'Use dark theme'} onClick={toggleTheme} className="rounded-lg p-200 hover:bg-accent">
              {isDark ? <Sun aria-hidden="true" className="icon-size-300" /> : <Moon aria-hidden="true" className="icon-size-300" />}
            </button>
            <button type="button" aria-label="Sign out" onClick={() => void signOut()} className="rounded-lg p-200 hover:bg-accent"><LogOut aria-hidden="true" className="icon-size-300" /></button>
          </div>
        </div>
      </header>
      <main id="scanner-content" className="mx-auto max-w-content space-y-600 p-500 md:p-800" tabIndex={-1}>
        <section className="rounded-2xl border border-border bg-card p-600 md:p-800">
          <div className="flex flex-col justify-between gap-500 sm:flex-row sm:items-end">
            <div>
              <h1 className="font-heading text-hero-800 leading-hero-800">Scan semantic models</h1>
              <p className="mt-300 max-w-prose text-muted-foreground">Select semantic models to check descriptions and AI-instruction presence.</p>
            </div>
            <div className="shrink-0 space-y-300 sm:text-right">
              <p id="scan-selection" aria-live="polite" aria-atomic="true" className="text-200 text-muted-foreground">
                {countLabel(selectedModels.length, 'model')} selected in {countLabel(selectedWorkspaceCount, 'workspace')}.
              </p>
              <button type="button" disabled={busy || selectedModels.length === 0} onClick={() => {
                if (tab === 'workspaces') setTab('readiness');
                void scanner.scan(selectedModels);
              }}
                aria-describedby="scan-selection scan-capabilities"
                className="inline-flex min-h-control items-center justify-center gap-200 rounded-lg bg-primary px-500 py-300 font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
                {scanner.phase === 'scanning' ? <LoaderCircle aria-hidden="true" className="icon-size-200 animate-spin motion-reduce:animate-none" /> : <ScanLine aria-hidden="true" className="icon-size-200" />}
                {scanner.phase === 'scanning' ? 'Reading metadata...' : scanner.results.length > 0 ? 'Scan again' : 'Scan selected models'}
              </button>
            </div>
          </div>
          {scanner.account && <p className="mt-300 wrap-anywhere text-200 text-muted-foreground">Source account: {scanner.account}</p>}
          <p id="scan-capabilities" className="mt-500 flex items-start gap-200 border-t border-border pt-400 text-muted-foreground">
            <LockKeyhole aria-hidden="true" className="mt-100 icon-size-200 shrink-0" />
            Read-only metadata: names, descriptions, visibility, and AI-instruction presence. No business-row queries, source changes, or saved scans. Instruction text is not retained.
          </p>
          {scanner.progress && (
            <div className="mt-400 flex flex-wrap items-center justify-between gap-300">
              <p role="status" className="wrap-anywhere text-200 text-muted-foreground">{scanner.progress}</p>
              {scanner.phase === 'scanning' && <button type="button" onClick={scanner.cancelScan} className="min-h-control rounded-lg border border-border px-400 py-200 hover:bg-accent">Stop scan</button>}
            </div>
          )}
        </section>
        {signOutError && <p role="alert" className="rounded-xl border border-destructive p-400 text-destructive">{signOutError}</p>}
        {scanner.error && <p role="alert" className="rounded-xl bg-warning p-400 text-warning-foreground">{scanner.error}</p>}
        <Tabs.Root value={tab} onValueChange={setTab} className="space-y-500">
          <Tabs.List aria-label="Scanner views" className="grid grid-cols-3 gap-100 border-b border-border sm:flex sm:gap-200">
            <Tabs.Trigger value="workspaces" className="inline-flex min-h-control min-w-0 items-center justify-center gap-200 border-b-2 border-transparent px-200 py-300 text-200 font-semibold text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-primary sm:justify-start sm:px-400 sm:text-300">
              <FolderOpen aria-hidden="true" className="hidden icon-size-200 shrink-0 sm:block" />Workspaces &amp; models
            </Tabs.Trigger>
            <Tabs.Trigger value="readiness" className="inline-flex min-h-control min-w-0 items-center justify-center gap-200 border-b-2 border-transparent px-200 py-300 text-200 font-semibold text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-primary sm:justify-start sm:px-400 sm:text-300">
              <BarChart3 aria-hidden="true" className="hidden icon-size-200 shrink-0 sm:block" />AI readiness
            </Tabs.Trigger>
            <Tabs.Trigger value="descriptions" className="inline-flex min-h-control min-w-0 items-center justify-center gap-200 border-b-2 border-transparent px-200 py-300 text-200 font-semibold text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-primary sm:justify-start sm:px-400 sm:text-300">
              <BookOpen aria-hidden="true" className="hidden icon-size-200 shrink-0 sm:block" />Description findings
            </Tabs.Trigger>
          </Tabs.List>
        {failures.length > 0 && (
          <section role="alert" className="rounded-2xl border border-border bg-warning p-600 text-warning-foreground">
            <h2 className="font-heading text-500 leading-500">Workspace inventory is incomplete</h2>
            <p className="mt-200">Models could not be listed in {failures.length} workspaces. You can scan the discovered models, but that is not an all-workspace scan. Check access and refresh the inventory.</p>
            <ul className="mt-300 space-y-200">
              {failures.map((workspace) => <li key={workspace.id} className="wrap-anywhere"><strong>{workspace.name}:</strong> {workspace.status === 'error' && workspace.error}</li>)}
            </ul>
          </section>
        )}
        <Tabs.Content value="workspaces" forceMount hidden={tab !== 'workspaces'} className="space-y-500">
        <section aria-labelledby="connection-title" className="rounded-2xl border border-border bg-card p-600">
          <div className="flex flex-col justify-between gap-400 sm:flex-row sm:items-center">
            <div className="min-w-0">
              <h2 id="connection-title" className="font-heading text-500 leading-500">Your Fabric workspaces</h2>
              <p className="mt-200 wrap-anywhere text-muted-foreground">
                {scanner.account ? `Connected as ${scanner.account}` : 'Connect the Microsoft account whose workspaces you want to scan. Read-only permission consent may be required.'}
              </p>
              <p className="mt-200 text-200 text-muted-foreground">Discovery lists workspace and model names. Object metadata is read only when you start a scan.</p>
              {canReopenSignIn && (
                <p id="workspace-signin-help" className="mt-200 text-200 text-muted-foreground">
                  Closed or blocked the popup? Reopen sign-in starts a new attempt and cancels the pending one. Close any earlier sign-in window.
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap gap-300">
              <button type="button" disabled={!scanner.ready || (busy && !connecting)} onClick={() => void loadInventory(true, canReopenSignIn)}
                aria-describedby={canReopenSignIn ? 'workspace-signin-help' : undefined}
                className="min-h-control rounded-lg bg-primary px-400 py-300 font-semibold text-primary-foreground disabled:opacity-50">
                {canReopenSignIn ? 'Reopen sign-in' : scanner.account ? 'Change account' : 'Connect workspaces'}
              </button>
              {scanner.account && (
                <button type="button" disabled={busy} onClick={() => void loadInventory(false)}
                  className="min-h-control rounded-lg border border-border px-400 py-300 font-semibold hover:bg-accent disabled:opacity-50">Refresh inventory</button>
              )}
            </div>
          </div>
          {isEmbedded && scanner.ready && !scanner.account && scanner.signInTimedOut && (
            <div className="mt-500 flex flex-col gap-400 rounded-xl border border-border bg-accent p-400 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-accent-foreground">Trouble connecting inside Fabric?</h3>
                <p id="standalone-scanner-help" className="mt-200 text-200 leading-300 text-accent-foreground">
                  Workspace sign-in timed out here. Open the scanner in its own tab. Connect workspaces and run scans there.
                  {' '}Signing in there does not connect this Fabric view; selections and results stay in each tab.
                </p>
              </div>
              <a href={`${window.location.origin}${window.location.pathname}`} target="_blank" rel="noopener noreferrer"
                aria-describedby="standalone-scanner-help"
                className="inline-flex min-h-control shrink-0 items-center justify-center gap-200 rounded-lg border border-border bg-card px-400 py-300 text-center font-semibold text-foreground hover:bg-muted">
                <ExternalLink aria-hidden="true" className="icon-size-200 shrink-0" />
                Open scanner in a new tab
              </a>
            </div>
          )}
        </section>
        <div className="grid gap-500 lg:grid-cols-3">
          <section aria-labelledby="workspace-scope-title" className="rounded-2xl border border-border bg-card p-600">
            <div className="flex items-center justify-between gap-300">
              <h2 id="workspace-scope-title" className="flex items-center gap-200 font-heading text-500 leading-500"><FolderOpen aria-hidden="true" className="icon-size-300 text-primary" />Workspaces</h2>
              <span className="text-200 text-muted-foreground">{scanner.catalog ? `${workspaces.length} accessible` : 'Not discovered'}</span>
            </div>
            <fieldset disabled={busy || !scanner.catalog} className="mt-500 space-y-300">
              <legend className="sr-only">Workspace scan scope</legend>
              <label className="flex min-h-control cursor-pointer items-start gap-300 rounded-lg border border-border p-400 has-checked:border-primary has-checked:bg-accent">
                <input type="radio" name="workspace-scope" checked={scope === 'all'} onChange={() => chooseScope('all')} className="mt-100 accent-primary" />
                <span><span className="block font-semibold">All accessible workspaces</span><span className="text-200 text-muted-foreground">Include discovered models across your workspace inventory.</span></span>
              </label>
              <label className="flex min-h-control cursor-pointer items-center gap-300 rounded-lg border border-border p-400 has-checked:border-primary has-checked:bg-accent">
                <input type="radio" name="workspace-scope" checked={scope === 'selected'} onChange={() => chooseScope('selected')} className="accent-primary" />
                <span className="font-semibold">Choose workspaces</span>
              </label>
              {workspaces.map((workspace) => (
                <label key={workspace.id} className="flex min-h-control cursor-pointer items-start gap-300 rounded-lg bg-muted p-400">
                  <input type="checkbox" aria-label={`Include ${workspace.name} workspace`} disabled={scope === 'all'}
                    checked={scope === 'all' || workspaceIds.has(workspace.id)}
                    onChange={(event) => chooseWorkspace(workspace, event.target.checked)} className="mt-100 accent-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block wrap-anywhere font-semibold">{workspace.name}</span>
                    <span className="block text-200 text-muted-foreground">{workspace.personal ? 'Personal workspace' : workspace.id.slice(0, 8)}</span>
                  </span>
                  <span className="shrink-0 text-200 text-muted-foreground">{workspace.status === 'ready' ? countLabel(workspace.models.length, 'model') : 'Unavailable'}</span>
                </label>
              ))}
            </fieldset>
            <p className="mt-500 border-t border-border pt-400 text-200 leading-300 text-muted-foreground">
              {scanner.catalog
                ? "This is the connected account's live inventory, including its personal workspace when returned by Fabric. Access changes require refreshing."
                : 'No workspace list is bundled with this app. Connect to discover the workspaces and models available to your account.'}
              {scanner.catalog?.length === 0 && ' No accessible workspaces were returned. Check the connected account and its Fabric permissions.'}
            </p>
          </section>
          <section aria-labelledby="models-title" className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card lg:col-span-2">
            <div className="flex flex-col justify-between gap-400 border-b border-border p-600 sm:flex-row sm:items-center">
              <div>
                <h2 id="models-title" className="flex items-center gap-200 font-heading text-500 leading-500"><Layers3 aria-hidden="true" className="icon-size-300 text-primary" />Semantic models</h2>
                <p className="mt-200 text-200 text-muted-foreground">{scopedModels.length} discovered in your workspace scope{failures.length > 0 ? ' / incomplete inventory' : ''}.</p>
              </div>
              <label className="flex min-h-control items-center gap-200 rounded-lg border border-input px-300">
                <Search aria-hidden="true" className="icon-size-200 shrink-0 text-muted-foreground" />
                <input type="search" aria-label="Search models" placeholder="Search models or workspaces" value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 w-full bg-transparent py-200 text-300" />
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <caption className="sr-only">Discovered semantic models</caption>
                <thead className="bg-muted text-200 text-muted-foreground">
                  <tr>
                    <th scope="col" className="p-400"><label className="inline-flex min-h-control cursor-pointer items-center rounded-lg p-200 hover:bg-accent"><input type="checkbox" aria-label="Select all models in scope"
                      disabled={busy || scopedModels.length === 0} checked={allSelected}
                      ref={(element) => { if (element) element.indeterminate = !allSelected && selectedModels.length > 0; }}
                      onChange={(event) => chooseModels(scopedModels, event.target.checked)} className="accent-primary" /></label></th>
                    <th scope="col" className="p-400">Semantic model</th>
                    <th scope="col" className="p-400">Workspace</th>
                    <th scope="col" className="p-400">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleModels.map((model) => (
                    <tr key={modelKey(model)}>
                      <td className="p-400"><label className="inline-flex min-h-control cursor-pointer items-center rounded-lg p-200 hover:bg-accent"><input type="checkbox"
                        aria-label={`Select ${model.name} model in ${model.workspaceName}`} disabled={busy} checked={selectedIds.has(modelKey(model))}
                        onChange={(event) => chooseModels([model], event.target.checked)} className="accent-primary" /></label></td>
                      <th scope="row" className="wrap-anywhere p-400 font-semibold">{model.name}<span className="mt-100 block font-mono text-200 font-normal text-muted-foreground">{model.id.slice(0, 8)}</span></th>
                      <td className="wrap-anywhere p-400">{model.workspaceName}</td>
                      <td className="p-400 text-200 text-muted-foreground">{modelStatus(resultByModel.get(modelKey(model)))}</td>
                    </tr>
                  ))}
                  {visibleModels.length === 0 && (
                    <tr><td colSpan={4} className="p-600 text-muted-foreground">{
                      scanner.phase === 'discovering' ? 'Discovering semantic models...' :
                        !scanner.catalog ? 'Connect workspaces to discover semantic models.' :
                          scopedModels.length > 0 ? 'No discovered models match your search.' :
                            'No semantic models were discovered in this scope. Check workspace selection, discovery errors, and source access.'
                    }</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-300 border-t border-border p-400">
              <p className="text-200 text-muted-foreground">
                {selectedModels.length === 0 ? 'Select at least one model to scan.' :
                  hiddenSelections > 0 ? `Your selection includes ${countLabel(hiddenSelections, 'model')} hidden by search.` :
                    'Search filters the list, not your scan selection.'}
              </p>
              <button type="button" disabled={busy || selectedModels.length === 0} onClick={() => chooseModels(scopedModels, false)} className="min-h-control rounded-lg px-300 py-200 text-200 font-semibold text-primary hover:bg-accent disabled:opacity-50">Clear selection</button>
            </div>
          </section>
        </div>
        </Tabs.Content>
        <Tabs.Content value="readiness">
          <Suspense fallback={<p role="status" className="p-600 text-muted-foreground">Opening readiness overview...</p>}>
            <ReadinessOverview models={selectedModels} results={scanner.results} />
          </Suspense>
        </Tabs.Content>
        <Tabs.Content value="descriptions" forceMount hidden={tab !== 'descriptions'} className="space-y-500">
        {scanner.results.length === 0 ? (
          <section className="rounded-2xl border border-border p-600 text-center">
            <BookOpen aria-hidden="true" className="mx-auto icon-size-600 text-primary" />
            <h2 className="mt-400 font-heading text-500 leading-500">Your description findings will appear here</h2>
            <p className="mx-auto mt-300 max-w-prose text-muted-foreground">Choose your scope on Workspaces &amp; models, then use Scan selected models above. The same scan feeds both results tabs. Findings stay grouped by workspace and model.</p>
          </section>
        ) : (
          <section aria-labelledby="workspace-results-title" className="space-y-500">
            <div>
              <h2 id="workspace-results-title" className="font-heading text-600 leading-600">Description findings</h2>
              <p className="mt-200 text-muted-foreground">{countLabel(completed, 'model')} read / {failed} failed / {empty} returned no metadata / {scanner.results.length - completed - failed - empty} waiting or not scanned.</p>
              <p className="mt-200 wrap-anywhere text-200 text-muted-foreground">Source account: {scanner.account}. Errors and empty responses are not clean-model certifications.</p>
            </div>
            {workspaces.filter((workspace) => scanner.results.some((result) => result.model.workspaceId === workspace.id)).map((workspace) => (
              <section key={workspace.id} aria-label={`Workspace: ${workspace.name}`} className="space-y-400">
                <h3 className="flex items-center gap-200 font-heading text-500 leading-500"><FolderOpen aria-hidden="true" className="icon-size-300 text-primary" />Workspace: {workspace.name}</h3>
                {scanner.results.filter((result) => result.model.workspaceId === workspace.id).map((result) => (
                  <ModelResult key={modelKey(result.model)} result={result} autoExpand={scanner.results.length === 1} />
                ))}
              </section>
            ))}
          </section>
        )}
        </Tabs.Content>
        </Tabs.Root>
        <footer className="border-t border-border pt-500 text-200 leading-300 text-muted-foreground">
          Results stay on this page and clear when you reload or sign out. Scan again to refresh them.
          Changing the account, inventory, or selection clears findings. Description presence does not establish accuracy or Copilot readiness.
          Each model is limited to 2,000 metadata objects; oversized or incomplete inventories are rejected.
        </footer>
      </main>
    </div>
  );
}
