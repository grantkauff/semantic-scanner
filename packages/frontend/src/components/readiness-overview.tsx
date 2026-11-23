import { useCallback, useMemo, useRef, useState } from 'react';
import { BookOpen, CheckCircle2, ChevronDown, CircleHelp, ClipboardCheck, FileText, X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tooltip from '@radix-ui/react-tooltip';
import { DataGrid, type GridColumnDef } from '@microsoft/fabric-datagrid';
import {
  EmbeddableVegaVisual as VegaVisual, useCssTheme, type VegaLiteConfig,
  type VegaVisualCapabilities, type VegaVisualEventCallback,
} from '@microsoft/fabric-visuals/embeddable';
import type { DataTable, InteractionEvent } from '@microsoft/fabric-visuals-core';
import type { ModelScanResult } from '@/hooks/use-workspace-scanner';
import type { SemanticModel } from '@/lib/fabric-discovery';
import {
  buildReadinessReport, formatCoverage, type ReadinessModel,
} from '@/lib/model-readiness';
import { descriptionCoverage, descriptionCoverageSpec } from '@/queries/description-coverage';

const instructionsGuide = 'https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-prepare-data-ai-instructions';
const chartCapabilities: VegaVisualCapabilities = { disableMinBarSize: true, disableStackedDataLabels: true };
const coverageColumns = [
  { id: 'TableCoverage', kind: 'Table', header: 'Tables %' },
  { id: 'ColumnCoverage', kind: 'Column', header: 'Columns %' },
  { id: 'MeasureCoverage', kind: 'Measure', header: 'Measures %' },
] as const;
const presenceLabels = { Pass: 'Present', Fail: 'Missing', Review: 'Needs review' } as const;
type PresenceLabel = (typeof presenceLabels)[keyof typeof presenceLabels];
type ObjectCoverage = NonNullable<ReadinessModel['coverage']>[number];

function Status({ value }: { value: PresenceLabel }) {
  const style = value === 'Present' ? 'bg-accent text-accent-foreground'
    : value === 'Missing' ? 'bg-warning text-warning-foreground' : 'bg-review text-review-foreground';
  return <span className={`inline-flex items-center gap-100 rounded-md px-200 py-100 text-200 font-semibold ${style}`}>
    {value === 'Present' ? <CheckCircle2 aria-hidden="true" className="icon-size-100" /> : <CircleHelp aria-hidden="true" className="icon-size-100" />}
    {value}
  </span>;
}

function unknownCoverageLabel(entry: ReadinessModel) {
  if (entry.scanStatus === 'Not scanned') return 'Not scanned yet';
  if (entry.scanStatus === 'Waiting' || entry.scanStatus === 'Reading metadata') return entry.scanStatus;
  return 'Needs review';
}

function CoverageValue({ coverage, fallback }: { coverage: ObjectCoverage | undefined; fallback: string }) {
  if (!coverage) return <span className="text-200 text-muted-foreground">{fallback}</span>;
  const ratio = coverage.total === 0 ? null : coverage.documented / coverage.total;
  const detail = ratio === null
    ? `No eligible ${coverage.kind.toLowerCase()}s in the inspected scope.`
    : `${coverage.documented} of ${coverage.total} eligible ${coverage.kind.toLowerCase()}s described.`;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button type="button" aria-label={`${coverage.kind} descriptions: ${formatCoverage(ratio)}`}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
          }}
          className="block w-full cursor-help rounded-md text-right">
          <span className="font-numeric tabular-nums">{formatCoverage(ratio)}</span>
          {ratio !== null && <span aria-hidden="true" className="mt-100 block h-100 overflow-hidden rounded-full bg-muted">
            <span className="block h-full bg-primary" style={{ width: `${ratio * 100}%` }} />
          </span>}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="z-60 rounded-lg bg-foreground px-300 py-200 text-200 leading-200 text-background">
          {detail}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function ReadinessGuide() {
  return (
    <details aria-label="Readiness guide" className="group rounded-2xl border border-border bg-card">
      <summary className="flex min-h-control cursor-pointer list-none items-center gap-300 rounded-2xl p-500 hover:bg-accent [&::-webkit-details-marker]:hidden">
        <BookOpen aria-hidden="true" className="icon-size-400 shrink-0 text-primary" />
        <span className="flex-1">
          <span className="font-heading text-400 font-semibold">Readiness guide</span>
          <span className="mt-100 block text-200 text-muted-foreground">What the checks mean, how AI uses the metadata, and where to update it.</span>
        </span>
        <ChevronDown aria-hidden="true" className="icon-size-300 shrink-0 text-primary group-open:rotate-180" />
      </summary>
      <div className="space-y-500 border-t border-border p-500">
        <div className="grid gap-600 lg:grid-cols-3">
          <div className="space-y-300">
            <h3 className="font-heading text-500 leading-500">Model description</h3>
            <p>Helps Copilot discover the right semantic model and understand what questions it can answer. This is the model's catalog description, separate from field descriptions and AI instructions.</p>
            <p className="text-200 text-muted-foreground"><strong>To update:</strong> Open the semantic model in Power BI, then File &gt; Settings &gt; Semantic model description. Apply the change, then use Refresh inventory on Workspaces &amp; models.</p>
            <a href="https://learn.microsoft.com/en-us/power-bi/create-reports/tutorial-copilot-power-bi-prepare-model#descriptions" target="_blank" rel="noreferrer" className="inline-block text-200 font-semibold text-primary underline">Model description guidance</a>
          </div>
          <div className="space-y-300">
            <h3 className="font-heading text-500 leading-500">Field descriptions</h3>
            <p>Explain individual tables, columns, and measures. Microsoft documents table and column descriptions for Copilot search and DAX queries; not every Copilot feature uses them.</p>
            <p className="text-200 text-muted-foreground"><strong>To update:</strong> Edit object descriptions in the model editor, save or publish your changes, then scan again. The summary and model grid report table, column, and measure percentages separately.</p>
            <a href="https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-prepare-data-ai-faq#tooling-features" target="_blank" rel="noreferrer" className="inline-block text-200 font-semibold text-primary underline">Field description guidance</a>
          </div>
          <div className="space-y-300">
            <h3 className="font-heading text-500 leading-500">AI instructions</h3>
            <p>Provide business context, terminology, and guidance on interpreting the data. They help Copilot understand business rules that a model description alone does not explain.</p>
            <p className="text-200 text-muted-foreground"><strong>To update:</strong> In Power BI's Prep data for AI, choose Add AI instructions. Apply or save your changes, publish if using Desktop, then scan again.</p>
            <a href={instructionsGuide} target="_blank" rel="noreferrer" className="inline-block text-200 font-semibold text-primary underline">AI instruction guidance</a>
          </div>
        </div>
        <section className="rounded-xl bg-muted p-400">
          <h3 className="font-semibold">How to read the results</h3>
          <dl className="mt-300 grid gap-400 sm:grid-cols-2">
            <div><dt className="font-semibold">Present</dt>
              <dd className="mt-100 text-200 text-muted-foreground">A nonblank model description or AI instruction was found. This does not certify its quality or AI accuracy.</dd>
            </div>
            <div><dt className="font-semibold">Missing: not broken</dt>
              <dd className="mt-100 text-200 text-muted-foreground">No nonblank value was found in the inspected scope. This does not mean the model is broken or the scan failed.</dd>
            </div>
            <div><dt className="font-semibold">Needs review: inconclusive</dt>
              <dd className="mt-100 text-200 text-muted-foreground">Evidence is unavailable or inconclusive. Permissions, empty responses, and unsupported metadata can cause this; open model details for the reason. Before a description scan starts, its coverage is Not scanned yet.</dd>
            </div>
            <div><dt className="font-semibold">N/A: no eligible objects</dt>
              <dd className="mt-100 text-200 text-muted-foreground">The scope was inspected successfully but has no eligible objects. This is not zero or perfect coverage.</dd>
            </div>
          </dl>
        </section>
        <p className="text-200 text-muted-foreground">Each scan checks nonblank AI-instruction presence in returned linguistic metadata. Empty results, permission failures, limits, and unrecognized formats need review; instruction text is discarded after inspection.</p>
        <p className="text-200 text-muted-foreground">Coverage is described / eligible for each object type, excluding hidden objects and children of hidden tables. Summary percentages use summed counts, not averages of model percentages. Failed, stopped, pending, and empty responses contribute no denominator.</p>
        <p className="text-200 text-muted-foreground">The scanner checks presence, not usefulness, and does not edit source models. Refreshing inventory clears current scan results; scan again to rebuild them.</p>
      </div>
    </details>
  );
}

function selectionValue(events: InteractionEvent[], name: string) {
  for (const event of events) {
    if (event.action === 'clear') return null;
    for (const selection of event.selections) {
      for (const predicate of selection.predicates) {
        if (predicate.type === 'set' && predicate.name === name && typeof predicate.values[0] === 'string') {
          return predicate.values[0];
        }
      }
    }
  }
  return null;
}

function ModelEvidence({ entry, onCloseAutoFocus }: { entry: ReadinessModel; onCloseAutoFocus: (event: Event) => void }) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-foreground/30" />
      <Dialog.Content onCloseAutoFocus={onCloseAutoFocus}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-model-details flex-col border-l border-border bg-card text-card-foreground">
        <div className="flex items-start justify-between gap-300 border-b border-border p-500">
          <div className="min-w-0">
            <p className="text-200 font-semibold uppercase tracking-widest text-primary">Model evidence</p>
            <Dialog.Title className="mt-200 wrap-anywhere font-heading text-600 leading-600">{entry.model.name}</Dialog.Title>
            <Dialog.Description className="mt-200 wrap-anywhere text-muted-foreground">Workspace: {entry.model.workspaceName}</Dialog.Description>
          </div>
          <Dialog.Close asChild>
            <button type="button" aria-label="Close model details" className="flex min-h-control min-w-control shrink-0 items-center justify-center rounded-lg hover:bg-accent">
              <X aria-hidden="true" className="icon-size-300" />
            </button>
          </Dialog.Close>
        </div>
        <section aria-label={`Readiness evidence: ${entry.model.name} in ${entry.model.workspaceName}`} className="min-h-0 flex-1 space-y-500 overflow-y-auto overscroll-contain p-500">
          <p className="wrap-anywhere text-muted-foreground">{entry.scanStatus === 'Review' ? 'Needs review' : entry.scanStatus}. {entry.scanReason}</p>
          {entry.coverage && <dl className="space-y-400 rounded-xl bg-muted p-400">
            {entry.coverage.map((group) => <div key={group.kind} className="flex justify-between gap-300">
              <dt className="font-semibold">{group.kind}s described</dt>
              <dd className="text-right">
                <span className="font-numeric">{formatCoverage(group.total === 0 ? null : group.documented / group.total)}</span>
                <span className="mt-100 block text-200 text-muted-foreground">{group.documented} of {group.total} eligible</span>
              </dd>
            </div>)}
          </dl>}
          {entry.excludedHidden !== null && <p className="text-200 text-muted-foreground">{entry.excludedHidden} hidden objects excluded.</p>}
          <dl className="space-y-500">
            <div><dt className="flex flex-wrap items-center gap-200 font-semibold">Model description <Status value={presenceLabels[entry.modelDescription]} /></dt>
              <dd className="mt-200 text-200 text-muted-foreground">{entry.modelDescription === 'Pass'
                ? 'A nonblank catalog description was returned during workspace discovery.'
                : entry.modelDescription === 'Fail' ? 'The catalog returned a blank model description. Add one in the model details and refresh inventory.'
                  : 'The catalog did not return this property. Missing evidence is not a blank description.'}</dd>
            </div>
            <div><dt className="flex flex-wrap items-center gap-200 font-semibold">AI instructions <Status value={presenceLabels[entry.aiInstructions]} /></dt>
              <dd className="mt-200 text-200 text-muted-foreground">{entry.aiInstructionsReason}</dd>
            </div>
          </dl>
        </section>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export default function ReadinessOverview({ models, results }: { models: SemanticModel[]; results: ModelScanResult[] }) {
  const report = useMemo(() => buildReadinessReport(models, results), [models, results]);
  const theme = useCssTheme();
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<string | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const modelOpener = useRef<HTMLElement | null>(null);
  const tableHeading = useRef<HTMLHeadingElement>(null);
  const onChartInteraction = useCallback((events: InteractionEvent[]) => setSelectedKind(selectionValue(events, 'ObjectType')), []);
  const onModelInteraction = useCallback((events: InteractionEvent[]) => {
    const key = selectionValue(events, 'ModelKey');
    if (key !== null) modelOpener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement : null;
    setSelectedModel(key);
  }, []);
  const restoreModelFocus = useCallback((event: Event) => {
    event.preventDefault();
    if (modelOpener.current?.isConnected) modelOpener.current.focus();
    else tableHeading.current?.focus();
  }, []);
  const onChartEvent = useCallback<VegaVisualEventCallback>((event) => {
    if (event.detail.type === 'error') setChartError(event.detail.message);
  }, []);
  const chartConfig = useMemo<VegaLiteConfig>(() => ({
    range: { category: [theme.brandForeground, theme.foregroundSecondary] },
  }), [theme]);
  const chartData = useMemo(() => descriptionCoverage(report), [report]);
  const selectedEntry = report.entries.find((entry) => entry.key === selectedModel);
  const selectedGroup = report.contributing > 0 ? report.groups.find((group) => `${group.kind}s` === selectedKind) : undefined;
  const hasStarted = report.entries.some((entry) => entry.scanStatus !== 'Not scanned');
  const scanning = report.entries.some((entry) => entry.scanStatus === 'Reading metadata' || entry.scanStatus === 'Waiting');
  const summaryState = scanning ? 'Scanning...' : hasStarted ? 'Needs review' : 'Not scanned yet';
  const gridData = useMemo<DataTable>(() => ({
    columns: [
      { name: 'ModelKey', displayName: 'Semantic model' },
      { name: 'Workspace', displayName: 'Workspace' },
      { name: 'ScanStatus', displayName: 'Metadata scan' },
      ...coverageColumns.map(({ id, kind }) => ({ name: id, displayName: `${kind} descriptions %`, format: '0.0%' })),
      { name: 'ModelDescription', displayName: 'Model description' },
      { name: 'AIInstructions', displayName: 'AI instructions' },
    ],
    rows: report.entries.map((entry) => [
      entry.key, entry.model.workspaceName, entry.scanStatus === 'Review' ? 'Needs review' : entry.scanStatus,
      ...coverageColumns.map(({ kind }) => {
        const group = entry.coverage?.find((item) => item.kind === kind);
        return group && group.total > 0 ? group.documented / group.total : null;
      }),
      presenceLabels[entry.modelDescription], presenceLabels[entry.aiInstructions],
    ]),
  }), [report]);
  const columns = useMemo<GridColumnDef[]>(() => [
    { id: 'ModelKey', header: 'Semantic model', sortable: false, filterable: false, cellRenderer: (value) => {
      const entry = report.entries.find((item) => item.key === value);
      if (!entry) throw new Error('The readiness model is no longer available. Refresh inventory and scan again.');
      return <button type="button" onClick={(event) => {
        event.stopPropagation();
        modelOpener.current = event.currentTarget;
        setSelectedModel(entry.key);
      }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        }} aria-haspopup="dialog" className="wrap-anywhere text-left font-semibold text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">
        {entry.model.name}<span className="mt-100 block font-mono text-200 font-normal text-muted-foreground">{entry.model.id.slice(0, 8)}</span>
      </button>;
    } },
    { id: 'Workspace', header: 'Workspace' },
    { id: 'ScanStatus', header: 'Metadata scan' },
    ...coverageColumns.map<GridColumnDef>(({ id, header, kind }) => ({
      id, header, numericStyling: true, cellRenderer: (_value, row) => {
        const entry = report.entries.find((item) => item.key === row.ModelKey);
        if (!entry) throw new Error('The readiness model is no longer available. Refresh inventory and scan again.');
        return <CoverageValue coverage={entry.coverage?.find((group) => group.kind === kind)} fallback={unknownCoverageLabel(entry)} />;
      },
    })),
    ...(['ModelDescription', 'AIInstructions'] as const).map<GridColumnDef>((id) => ({
      id,
      header: id === 'ModelDescription' ? 'Model description' : 'AI instructions',
      cellRenderer: (value) => typeof value === 'string' && (value === 'Present' || value === 'Missing' || value === 'Needs review') ? <Status value={value} /> : null,
    })),
  ], [report]);

  return (
    <Tooltip.Provider delayDuration={0}>
    <Dialog.Root open={selectedEntry !== undefined} onOpenChange={(open) => {
      if (!open) setSelectedModel(null);
    }}>
    <div className="space-y-500">
      <section className="flex flex-col justify-between gap-300 md:flex-row md:items-end">
        <div>
          <h2 className="font-heading text-600 leading-600">AI readiness overview</h2>
          <p className="mt-200 max-w-prose text-muted-foreground">Compare descriptions and AI instructions across your selected models. Presence checks do not certify AI accuracy.</p>
        </div>
        <p className="text-200 text-muted-foreground">{report.contributing} / {models.length} models inspected</p>
      </section>

      <div className="grid gap-500 md:grid-cols-3">
        {report.groups.map((group) => <section key={group.kind} aria-label={`${group.kind} description coverage`} className="rounded-2xl border border-border bg-card p-500">
          <p className="font-semibold">{group.kind}s described</p>
          <p className={`mt-200 flex min-h-control items-end font-numeric text-primary ${report.contributing === 0 ? 'text-500 leading-500' : 'text-hero-900 leading-hero-900'}`}>
            {report.contributing === 0 ? summaryState : formatCoverage(group.ratio)}
          </p>
          <p className="mt-200 text-200 text-muted-foreground">{report.contributing === 0
            ? hasStarted ? 'No complete description metadata available yet.' : 'Run a scan to calculate coverage.'
            : `${group.documented} of ${group.total} eligible ${group.kind.toLowerCase()}s.`}</p>
        </section>)}
      </div>
      <p className="flex items-center gap-200 text-200 text-muted-foreground">
        <ClipboardCheck aria-hidden="true" className="icon-size-200 shrink-0 text-primary" />
        {hasStarted
          ? `AI instructions: ${report.instructions.present} present / ${report.instructions.missing} missing / ${report.instructions.review} need review.`
          : 'AI instructions: not scanned yet.'}
      </p>

      {models.length === 0 ? (
        <section className="rounded-2xl border border-border bg-card p-600 text-center">
          <FileText aria-hidden="true" className="mx-auto icon-size-600 text-primary" />
          <h3 className="mt-300 font-heading text-500 leading-500">Choose models to compare</h3>
          <p className="mt-200 text-muted-foreground">Connect and select models on Workspaces &amp; models, then use Scan selected models above. The same scan populates both results tabs.</p>
        </section>
      ) : (
        <>
          <section aria-labelledby="readiness-models-title" className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="border-b border-border p-500">
              <h3 id="readiness-models-title" ref={tableHeading} tabIndex={-1} className="font-heading text-500 leading-500">Checks by model</h3>
              <p className="mt-200 text-200 text-muted-foreground">Tables %, Columns %, and Measures % show descriptions in each eligible scope. Focus or hover a percentage for counts; open a model for evidence and next steps.</p>
              <p className="mt-100 text-200 text-muted-foreground">Table filters do not change the weighted summaries above.</p>
            </div>
            <div className="overflow-auto">
              <DataGrid data={gridData} columns={columns} theme={theme} pageSize={10}
                onInteraction={onModelInteraction} />
            </div>
          </section>
          <section aria-labelledby="coverage-title" className="grid min-h-coverage-chart grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl border border-border bg-card p-500">
            <div>
              <h3 id="coverage-title" className="font-heading text-500 leading-500">Description coverage by object type</h3>
              <p className="mt-200 text-200 text-muted-foreground">Weighted counts from {report.contributing} of {models.length} selected models. Select a bar for its counts.</p>
            </div>
            <div className="flex min-h-0 min-w-0 flex-col pt-400">
              {chartError ? <p role="alert" className="rounded-lg bg-warning p-400 text-warning-foreground">The coverage chart could not render. {chartError} Model values remain available above.</p>
                : chartData.rows.length === 0 ? <p className="my-auto text-muted-foreground">{report.contributing === 0
                  ? 'Coverage is not available yet. Complete a successful description scan; failed or empty scans need review.'
                  : 'No eligible objects were returned in the inspected scope. Coverage is N/A, not 100%.'}</p>
                  : <VegaVisual spec={descriptionCoverageSpec} data={chartData} theme={theme} configVegaLite={chartConfig}
                    capabilities={chartCapabilities} onInteraction={onChartInteraction}
                    onEvent={onChartEvent} className="min-h-0 min-w-0 flex-1" />}
            </div>
            <p role="status" className="pt-300 text-200 text-muted-foreground">{selectedGroup
              ? `${selectedKind}: ${selectedGroup.documented} of ${selectedGroup.total} described / ${formatCoverage(selectedGroup.ratio)}.`
              : `${report.excludedHidden} hidden objects excluded. Object types with no eligible objects are N/A.`}</p>
          </section>
        </>
      )}
      <ReadinessGuide />
      {selectedEntry && <ModelEvidence entry={selectedEntry} onCloseAutoFocus={restoreModelFocus} />}
    </div>
    </Dialog.Root>
    </Tooltip.Provider>
  );
}
