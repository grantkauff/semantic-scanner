import { useEffect, useRef, useState } from 'react';

import {
  createDiscoveryClient, discoveryError, FabricReadAccessError, FabricSignInTimeoutError,
  type SemanticModel, type WorkspaceInventory,
} from '@/lib/fabric-discovery';
import type { DescriptionScan } from '@/lib/description-scan';
import type { AIInstructionsCheck } from '@/lib/ai-instructions';

export type ModelScanResult = { model: SemanticModel; aiInstructions?: AIInstructionsCheck } & (
  | { status: 'pending' | 'reading' | 'cancelled' }
  | { status: 'error'; error: string }
  | { status: 'success'; scan: DescriptionScan }
);

export function useWorkspaceScanner() {
  const [client] = useState(createDiscoveryClient);
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<WorkspaceInventory[] | null>(null);
  const [phase, setPhase] = useState<'connecting' | 'discovering' | 'scanning' | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [signInTimedOut, setSignInTimedOut] = useState(false);
  const [results, setResults] = useState<ModelScanResult[]>([]);
  const operation = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    void client.initialize().then(
      () => { if (active) setReady(true); },
      (failure: unknown) => { if (active) setError(`Read-access sign-in is unavailable. ${discoveryError(failure)}`); },
    );
    return () => {
      active = false;
      operation.current?.abort();
      void client.disconnect().catch(() => {
        console.error('The private Fabric read-access cache could not be cleared.');
      });
    };
  }, [client]);

  function begin(nextPhase: NonNullable<typeof phase>) {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setError(null);
    setSignInTimedOut(false);
    setResults([]);
    setPhase(nextPhase);
    return controller;
  }

  function current(controller: AbortController) {
    return operation.current === controller && !controller.signal.aborted;
  }

  async function load(controller: AbortController) {
    setPhase('discovering');
    const inventory = await client.discover(controller.signal, (message) => {
      if (current(controller)) setProgress(message);
    });
    if (!current(controller)) return;
    setCatalog(inventory);
    setProgress('Workspace discovery complete.');
    return inventory;
  }

  async function connect(restartPendingSignIn = false) {
    const controller = begin('connecting');
    setAccount(null);
    setCatalog(null);
    setProgress('Complete Microsoft sign-in in the popup...');
    try {
      const sourceAccount = await client.connect(restartPendingSignIn);
      if (!current(controller)) return;
      setAccount(sourceAccount);
      return await load(controller);
    } catch (failure) {
      if (current(controller)) {
        setError(discoveryError(failure));
        setSignInTimedOut(failure instanceof FabricSignInTimeoutError);
        setProgress('');
      }
      return undefined;
    } finally {
      if (current(controller)) setPhase(null);
    }
  }

  async function refresh() {
    const controller = begin('discovering');
    setCatalog(null);
    try {
      return await load(controller);
    } catch (failure) {
      if (current(controller)) {
        setError(discoveryError(failure));
        setProgress('');
      }
      return undefined;
    } finally {
      if (current(controller)) setPhase(null);
    }
  }

  function clearResults() {
    operation.current?.abort();
    setResults([]);
    setPhase(null);
    setProgress('');
  }

  async function scan(models: SemanticModel[]) {
    const controller = begin('scanning');
    const batch: ModelScanResult[] = models.map((model) => ({ model, status: 'pending' }));
    setResults([...batch]);
    for (const [index, model] of models.entries()) {
      if (!current(controller)) return;
      setProgress(`Reading model ${index + 1} of ${models.length}: ${model.name} (${model.workspaceName})...`);
      batch[index] = { model, status: 'reading' };
      setResults([...batch]);
      let accessError: FabricReadAccessError | undefined;
      try {
        const scan = await client.scan(model, controller.signal);
        if (!current(controller)) return;
        batch[index] = { model, status: 'success', scan };
      } catch (failure) {
        if (!current(controller)) return;
        batch[index] = { model, status: 'error', error: discoveryError(failure) };
        if (failure instanceof FabricReadAccessError) accessError = failure;
      }
      if (!accessError) {
        setProgress(`Checking AI instructions ${index + 1} of ${models.length}: ${model.name} (${model.workspaceName})...`);
        try {
          const aiInstructions = await client.scanAIInstructions(model, controller.signal);
          if (!current(controller)) return;
          batch[index] = { ...batch[index], aiInstructions };
        } catch (failure) {
          if (!current(controller)) return;
          batch[index] = {
            ...batch[index], aiInstructions: { status: 'error', reason: discoveryError(failure) },
          };
          if (failure instanceof FabricReadAccessError) accessError = failure;
        }
      }
      if (accessError) {
        setError(discoveryError(accessError));
        for (let pending = index + 1; pending < batch.length; pending++) {
          batch[pending] = { model: models[pending], status: 'cancelled' };
        }
        setResults([...batch]);
        setPhase(null);
        setProgress('Scan stopped. Reconnect before scanning the remaining models.');
        return;
      }
      setResults([...batch]);
    }
    if (current(controller)) {
      setPhase(null);
      setProgress('Scan finished. Review AI readiness or Description findings for each model outcome.');
    }
  }

  function cancelScan() {
    operation.current?.abort();
    setResults((previous) => previous.map((result) =>
      result.status === 'reading' || result.status === 'pending'
        ? { model: result.model, status: 'cancelled' }
        : result,
    ));
    setPhase(null);
    setProgress('Scan stopped. Completed results are retained; remaining models were not scanned.');
  }

  return {
    ready, account, catalog, phase, progress, error, signInTimedOut, results,
    connect, refresh, scan, cancelScan, clearResults,
  };
}
