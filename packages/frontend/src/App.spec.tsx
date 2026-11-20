import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { QueryTable } from '@microsoft/rayfin-connector-fabric-semanticmodel';
import type { DataTable, InteractionEvent, VisualTheme } from '@microsoft/fabric-visuals-core';
import type { DataGridProps } from '@microsoft/fabric-datagrid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '@/App';
import { AuthGate } from '@/components/auth-gate.component';
import { AuthContext, type AuthContextValue } from '@/hooks/auth.context';
import { analyzeDescriptions, type DescriptionScan } from '@/lib/description-scan';
import { FabricReadAccessError, FabricSignInTimeoutError, type WorkspaceInventory } from '@/lib/fabric-discovery';

const { source, factory, signOut } = vi.hoisted(() => ({
  source: {
    initialize: vi.fn(), connect: vi.fn(), discover: vi.fn(), scan: vi.fn(), scanAIInstructions: vi.fn(), disconnect: vi.fn(),
  },
  factory: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('@/lib/fabric-discovery', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/fabric-discovery')>(),
  createDiscoveryClient: factory,
}));
vi.mock('@/lib/rayfin-client', () => ({
  getRayfinClient: vi.fn(async () => ({ auth: { signOut } })),
}));
vi.mock('@microsoft/fabric-visuals/embeddable', () => ({
  useCssTheme: (): VisualTheme => ({
    foreground: '', foregroundSecondary: '', brandForeground: '', brandBackground: '',
    background: '', backgroundSecondary: '', backgroundHover: '', stroke: '',
  }),
  EmbeddableVegaVisual: ({ data, onInteraction }: { data: DataTable; onInteraction: (events: InteractionEvent[]) => void }) => (
    <div role="img" aria-label="Description coverage chart">{data.rows.length} coverage segments
      <button type="button" onClick={() => onInteraction([{ action: 'select', selections: [{ predicates: [{ type: 'set', name: 'ObjectType', values: ['Columns'] }] }] }])}>Select column coverage</button>
    </div>
  ),
}));
vi.mock('@microsoft/fabric-datagrid', () => ({
  DataGrid: ({ data, columns = [] }: DataGridProps) => {
    if (typeof data !== 'object' || data === null || !('columns' in data)) throw new Error('Expected readiness DataTable.');
    return <table aria-label="Readiness model checks"><thead><tr>{columns.map((column) => <th key={column.id}>{column.header}</th>)}</tr></thead>
      <tbody>{data.rows.map((values, index) => {
        const row: Record<string, string | number | null> = {};
        data.columns.forEach((column, position) => {
          const value = values[position];
          if (value !== null && typeof value !== 'string' && typeof value !== 'number') throw new Error('Expected a readiness cell value.');
          row[column.name] = value;
        });
        return <tr key={index}>{columns.map((column) => <td key={column.id}>
          {column.cellRenderer ? column.cellRenderer(row[column.id], row) : String(row[column.id] ?? '')}
        </td>)}</tr>;
      })}</tbody></table>;
  },
}));

const northModel = { id: 'north-model', name: 'Fleet', workspaceId: 'north', workspaceName: 'North' };
const southModel = { id: 'south-model', name: 'Deliveries', workspaceId: 'south', workspaceName: 'South' };
const inventory: WorkspaceInventory[] = [
  { id: 'north', name: 'North', personal: false, status: 'ready', models: [northModel] },
  { id: 'south', name: 'South', personal: true, status: 'ready', models: [southModel] },
];
const metadata: QueryTable = {
  columns: [
    { name: '[ObjectType]', dataType: 'String' }, { name: '[TableName]', dataType: 'String' },
    { name: '[ObjectName]', dataType: 'String' }, { name: '[Description]', dataType: 'String' },
    { name: '[IsHidden]', dataType: 'Boolean' }, { name: '[ExpectedObjectCount]', dataType: 'Int64' },
  ],
  rows: [
    ['Table', 'Fleet', 'Fleet', 'Vehicles', false, 4],
    ['Column', 'Fleet', 'TruckId', null, false, 4],
    ['Measure', 'Fleet', 'DeliveryTotal', '\t', false, 4],
    ['Column', 'Fleet', 'InternalId', null, true, 4],
  ],
};
const descriptionScan = analyzeDescriptions(metadata);

function authenticated(userId: string): AuthContextValue {
  return {
    session: { user: { id: userId, email: `${userId}@example.invalid` }, isAuthenticated: true, isAnonymous: false },
    isAuthenticated: true, isLoading: false, canSignIn: true,
    signIn: async () => {}, isSigningIn: false, signInError: null,
    config: { kind: 'ready' }, error: null,
  };
}

async function connect() {
  const button = screen.getByRole('button', { name: 'Connect workspaces' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Scan selected models' })).toBeEnabled());
}

function openTab(name: 'Workspaces & models' | 'AI readiness' | 'Description findings') {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false });
}

async function scanAndExpand() {
  fireEvent.click(screen.getByRole('button', { name: 'Scan selected models' }));
  openTab('Description findings');
  const summary = await screen.findByText('Model: Fleet / 2 missing descriptions');
  fireEvent.click(summary);
  await screen.findByRole('heading', { name: '2 objects need descriptions' });
}

describe('live workspace description scanning', () => {
  beforeEach(() => {
    for (const mock of Object.values(source)) mock.mockReset();
    factory.mockReset().mockImplementation(() => ({ ...source }));
    signOut.mockReset();
    source.initialize.mockResolvedValue(undefined);
    source.disconnect.mockResolvedValue(undefined);
    source.connect.mockResolvedValue('scanner@example.invalid');
    source.discover.mockResolvedValue(inventory);
    source.scan.mockResolvedValue(descriptionScan);
    source.scanAIInstructions.mockResolvedValue({ status: 'review', reason: 'No linguistic metadata was returned.' });
  });

  it('shows missing installation configuration instead of leaving workspace sign-in loading', async () => {
    source.initialize.mockRejectedValueOnce(new Error('Workspace sign-in needs setup. Run npm run setup, then rebuild and deploy.'));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('npm run setup');
    expect(screen.getByRole('button', { name: 'Connect workspaces' })).toBeDisabled();
    expect(source.connect).not.toHaveBeenCalled();
    expect(source.discover).not.toHaveBeenCalled();
  });

  it('requires a live connection and an explicit scan instead of showing a bundled pilot', async () => {
    render(<App />);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Workspaces & models', 'AI readiness', 'Description findings',
    ]);
    expect(screen.getByRole('tab', { name: 'Workspaces & models' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Workspaces & models' })).toBeVisible();
    expect(screen.getByText('0 models selected in 0 workspaces.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Scan selected models' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Open scanner in a new tab' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Select test model' })).toBeNull();
    expect(source.discover).not.toHaveBeenCalled();
    await connect();
    expect(screen.getByRole('radio', { name: /All accessible workspaces/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Fleet model in North' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Deliveries model in South' })).toBeChecked();
    expect(screen.getByText('Personal workspace')).toBeVisible();
    expect(screen.getByText('2 models selected in 2 workspaces.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Scan selected models' })).toHaveAccessibleDescription(
      /2 models selected in 2 workspaces\..*Read-only metadata:.*AI-instruction presence\./,
    );
    expect(source.scan).not.toHaveBeenCalled();
  });

  describe('embedded new-tab sign-in workaround', () => {
    const originalUrl = window.location.href;

    afterEach(() => {
      vi.restoreAllMocks();
      window.history.replaceState(null, '', originalUrl);
    });

    function renderEmbedded() {
      const { container } = render(<iframe title="Embedding window" />);
      const parent = container.querySelector('iframe')?.contentWindow;
      if (!parent) throw new Error('The embedding test window did not initialize.');
      vi.spyOn(window, 'parent', 'get').mockReturnValue(parent);
      return render(<App />);
    }

    it('offers the secure new-tab link only after a timeout and hides it when retrying', async () => {
      let finishRetry!: (account: string) => void;
      source.connect
        .mockRejectedValueOnce(new FabricSignInTimeoutError('Microsoft sign-in timed out.'))
        .mockImplementationOnce(() => new Promise((resolve) => { finishRetry = resolve; }));
      window.history.replaceState(null, '', '/scanner/index.html?code=test-code&state=test-state#test-fragment');
      renderEmbedded();
      const button = screen.getByRole('button', { name: 'Connect workspaces' });
      await waitFor(() => expect(button).toBeEnabled());
      expect(screen.queryByRole('link', { name: 'Open scanner in a new tab' })).toBeNull();
      fireEvent.click(button);
      const link = await screen.findByRole('link', { name: 'Open scanner in a new tab' });
      expect(link).toBeVisible();
      expect(link).toHaveAttribute('href', `${window.location.origin}/scanner/index.html`);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link).toHaveAccessibleDescription(/Connect workspaces and run scans there.*does not connect this Fabric view/);
      expect(source.connect).toHaveBeenCalledOnce();
      expect(source.discover).not.toHaveBeenCalled();
      expect(source.scan).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Reopen sign-in' }));
      expect(screen.getByText('Complete Microsoft sign-in in the popup...')).toBeVisible();
      expect(screen.queryByRole('link', { name: 'Open scanner in a new tab' })).toBeNull();
      await act(async () => { finishRetry('scanner@example.invalid'); });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Change account' })).toBeEnabled());
      expect(screen.queryByRole('link', { name: 'Open scanner in a new tab' })).toBeNull();
    });

    it.each(['pending', 'cancelled'])('hides the workaround when workspace sign-in is %s rather than timed out', async (state) => {
      if (state === 'pending') {
        source.connect.mockImplementationOnce(() => new Promise(() => {}));
      } else {
        source.connect.mockRejectedValueOnce(new FabricReadAccessError('Microsoft sign-in was cancelled.'));
      }
      renderEmbedded();
      const button = screen.getByRole('button', { name: 'Connect workspaces' });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      if (state === 'cancelled') {
        expect(await screen.findByRole('alert')).toHaveTextContent('Microsoft sign-in was cancelled.');
      } else {
        expect(screen.getByText('Complete Microsoft sign-in in the popup...')).toBeVisible();
      }
      expect(screen.queryByRole('link', { name: 'Open scanner in a new tab' })).toBeNull();
      expect(source.connect).toHaveBeenCalledOnce();
    });

    it('does not show the embedded workaround for a standalone sign-in timeout', async () => {
      source.connect.mockRejectedValueOnce(new FabricSignInTimeoutError('Microsoft sign-in timed out.'));
      render(<App />);
      const button = screen.getByRole('button', { name: 'Connect workspaces' });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      expect(await screen.findByRole('alert')).toHaveTextContent('Microsoft sign-in timed out.');
      expect(screen.queryByRole('link', { name: 'Open scanner in a new tab' })).toBeNull();
    });
  });

  it('offers an expandable readiness guide before connecting or scanning', async () => {
    render(<App />);
    openTab('AI readiness');
    const guide = await screen.findByLabelText('Readiness guide', {}, { timeout: 5000 });
    const toggle = within(guide).getByText('Readiness guide');
    const explanation = within(guide).getByText(/Helps Copilot discover the right semantic model/);
    expect(guide).not.toHaveAttribute('open');
    expect(explanation).not.toBeVisible();
    fireEvent.click(toggle);
    expect(guide).toHaveAttribute('open');
    expect(explanation).toBeVisible();
    for (const name of ['Model description', 'Field descriptions', 'AI instructions']) {
      expect(within(guide).getByRole('heading', { name })).toBeVisible();
    }
    expect(within(guide).getByText('Missing: not broken')).toBeVisible();
    expect(within(guide).getByText(/Refreshing inventory clears current scan results/)).toBeVisible();
    expect(within(guide).getAllByRole('link')).toHaveLength(3);
    expect(within(guide).getByRole('link', { name: 'Model description guidance' })).toHaveAttribute(
      'href', 'https://learn.microsoft.com/en-us/power-bi/create-reports/tutorial-copilot-power-bi-prepare-model#descriptions',
    );
    fireEvent.click(toggle);
    expect(explanation).not.toBeVisible();
    for (const kind of ['Table', 'Column', 'Measure']) {
      expect(within(screen.getByRole('region', { name: `${kind} description coverage` })).getByText('Not scanned yet')).toBeVisible();
    }
    expect(source.connect).not.toHaveBeenCalled();
    expect(source.discover).not.toHaveBeenCalled();
    expect(source.scan).not.toHaveBeenCalled();
    expect(source.scanAIInstructions).not.toHaveBeenCalled();
  });

  it('preserves setup and shared target counts across result tabs, then scans the selection rather than the search results', async () => {
    const extraModel = { ...northModel, id: 'extra-model', name: 'Costs' };
    source.discover.mockResolvedValue([
      { ...inventory[0], models: [northModel, extraModel] }, inventory[1],
    ]);
    render(<App />);
    await connect();
    expect(screen.getByText('3 models selected in 2 workspaces.')).toBeVisible();
    fireEvent.click(screen.getByRole('radio', { name: 'Choose workspaces' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include South workspace' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search models' }), { target: { value: 'Fleet' } });
    expect(screen.getByText('Your selection includes 1 model hidden by search.')).toBeVisible();

    for (const tab of ['AI readiness', 'Description findings'] as const) {
      openTab(tab);
      expect(await screen.findByRole('tabpanel', { name: tab })).toBeVisible();
      expect(screen.getByText('2 models selected in 1 workspace.')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Scan selected models' })).toBeEnabled();
      expect(screen.queryByRole('searchbox', { name: 'Search models' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Change account' })).toBeNull();
      expect(source.scan).not.toHaveBeenCalled();
      expect(source.discover).toHaveBeenCalledOnce();
    }

    openTab('Workspaces & models');
    expect(screen.getByRole('radio', { name: 'Choose workspaces' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Include South workspace' })).not.toBeChecked();
    expect(screen.getByRole('searchbox', { name: 'Search models' })).toHaveValue('Fleet');
    expect(screen.getByRole('checkbox', { name: 'Select Fleet model in North' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Scan selected models' }));
    expect(screen.getByRole('tab', { name: 'AI readiness' })).toHaveAttribute('aria-selected', 'true');
    await screen.findByText('Scan finished. Review AI readiness or Description findings for each model outcome.');
    expect(source.scan.mock.calls.map(([model]) => model)).toEqual([northModel, extraModel]);
    expect(screen.getByText('2 models selected in 1 workspace.')).toBeVisible();
  });

  it('scans all selected models and groups verified findings by workspace', async () => {
    render(<App />);
    await connect();
    await scanAndExpand();
    expect(source.scan.mock.calls.map(([model]) => model)).toEqual([northModel, southModel]);
    const findings = screen.getByRole('table', { name: 'Objects with missing descriptions' });
    expect(within(findings).getByText('TruckId')).toBeVisible();
    expect(within(findings).getByText('DeliveryTotal')).toBeVisible();
    expect(screen.queryByText('InternalId')).toBeNull();
    expect(screen.getByRole('region', { name: 'Workspace: South' })).toBeVisible();
  });

  it('supports selected workspaces and restores every discovered model in all-workspace scope', async () => {
    render(<App />);
    await connect();
    fireEvent.click(screen.getByRole('radio', { name: 'Choose workspaces' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include South workspace' }));
    expect(screen.queryByRole('checkbox', { name: 'Select Deliveries model in South' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Scan selected models' }));
    openTab('Description findings');
    await screen.findByRole('heading', { name: '2 objects need descriptions' });
    expect(source.scan).toHaveBeenCalledOnce();
    expect(source.scan.mock.calls[0][0]).toEqual(northModel);
    openTab('Workspaces & models');
    fireEvent.click(screen.getByRole('radio', { name: /All accessible workspaces/ }));
    expect(screen.getByRole('checkbox', { name: 'Select Deliveries model in South' })).toBeChecked();
    openTab('Description findings');
    expect(screen.queryByRole('table', { name: 'Objects with missing descriptions' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Your description findings will appear here' })).toBeVisible();
  });

  it('keeps hidden selections explicit and clears findings on selection changes', async () => {
    render(<App />);
    await connect();
    await scanAndExpand();
    openTab('Workspaces & models');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search models' }), { target: { value: 'no-match' } });
    expect(screen.getByText('No discovered models match your search.')).toBeVisible();
    expect(screen.getByText(/2 models hidden by search/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    openTab('Description findings');
    expect(screen.queryByRole('table', { name: 'Objects with missing descriptions' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Scan selected models' })).toBeDisabled();
  });

  it('reuses scan evidence across tabs and clears readiness coverage when the selection changes', async () => {
    const partlyDescribed = analyzeDescriptions({
      ...metadata,
      rows: metadata.rows.map((row) => row[2] === 'TruckId' ? [row[0], row[1], row[2], 'Vehicle identifier', ...row.slice(4)] : row),
    });
    source.discover.mockResolvedValue([
      { ...inventory[0], models: [{ ...northModel, descriptionStatus: 'present' }] },
      { ...inventory[1], models: [{ ...southModel, descriptionStatus: 'missing' }] },
    ]);
    source.scan.mockResolvedValueOnce(partlyDescribed).mockRejectedValueOnce(new Error('Build permission required.'));
    render(<App />);
    await connect();
    openTab('AI readiness');
    expect(await screen.findByRole('heading', { name: 'AI readiness overview' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Scan selected models' }));
    await screen.findByText('Scan finished. Review AI readiness or Description findings for each model outcome.');
    await screen.findByRole('heading', { name: 'AI readiness overview' });
    expect(within(screen.getByRole('region', { name: 'Table description coverage' })).getByText('100%')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Column description coverage' })).getByText('100%')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Measure description coverage' })).getByText('0%')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Description coverage chart' })).toBeVisible();
    const checks = screen.getByRole('table', { name: 'Readiness model checks' });
    const fleet = within(checks).getByRole('row', { name: /Fleet.*North/ });
    const deliveries = within(checks).getByRole('row', { name: /Deliveries.*South/ });
    expect(within(fleet).getAllByRole('cell').slice(3, 6).map((cell) => cell.textContent)).toEqual(['100%', '100%', '0%']);
    expect(within(deliveries).getAllByRole('cell', { name: 'Needs review' })).toHaveLength(4);
    expect(within(checks).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Semantic model', 'Workspace', 'Metadata scan', 'Tables %', 'Columns %',
      'Measures %', 'Model description', 'AI instructions',
    ]);
    fireEvent.click(within(deliveries).getByRole('button', { name: /Deliveries/ }));
    const evidence = screen.getByRole('region', { name: 'Readiness evidence: Deliveries in South' });
    expect(evidence).toHaveTextContent('Build permission required.');
    expect(evidence).toHaveTextContent('Model description');
    expect(evidence).toHaveTextContent('AI instructions');
    expect(evidence).not.toHaveTextContent('Approved for Copilot');
    fireEvent.click(screen.getByRole('button', { name: 'Close model details' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(source.scan).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Select column coverage' }));
    expect(screen.getByText('Columns: 1 of 1 described / 100%.')).toBeVisible();
    let finishScan: ((scan: DescriptionScan) => void) | undefined;
    source.scan.mockImplementationOnce(() => new Promise<DescriptionScan>((resolve) => { finishScan = resolve; }))
      .mockRejectedValueOnce(new Error('Build permission required.'));
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    await waitFor(() => expect(source.scan).toHaveBeenCalledTimes(3));
    expect(within(screen.getByRole('region', { name: 'Table description coverage' })).getByText('Scanning...')).toBeVisible();
    expect(screen.queryByText('Columns: 0 of 0 described / N/A.')).toBeNull();
    await act(async () => finishScan?.(partlyDescribed));
    await screen.findByText('Scan finished. Review AI readiness or Description findings for each model outcome.');
    openTab('Description findings');
    expect(await screen.findByText('Model: Fleet / 1 missing descriptions')).toBeVisible();
    expect(screen.getByText('2 models selected in 2 workspaces.')).toBeVisible();
    openTab('Workspaces & models');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Deliveries model in South' }));
    openTab('AI readiness');
    await screen.findByRole('heading', { name: 'AI readiness overview' });
    expect(screen.queryByRole('img', { name: 'Description coverage chart' })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Table description coverage' })).getByText('Not scanned yet')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Readiness evidence: Deliveries in South' })).toBeNull();
    expect(screen.getByText('1 model selected in 1 workspace.')).toBeVisible();
    expect(source.scan).toHaveBeenCalledTimes(4);
  });

  it('separates object-type percentages and distinguishes absent types from unavailable metadata', async () => {
    const emptyModel = { ...northModel, id: 'empty-model', name: 'Empty metadata' };
    source.discover.mockResolvedValue([
      { ...inventory[0], models: [northModel, emptyModel] }, inventory[1],
    ]);
    source.scan.mockResolvedValueOnce(analyzeDescriptions({
      ...metadata,
      rows: [
        ['Table', 'Fleet', 'Fleet', 'Vehicles', false, 7],
        ['Table', 'Trips', 'Trips', null, false, 7],
        ['Column', 'Fleet', 'TruckId', 'Vehicle identifier', false, 7],
        ['Column', 'Fleet', 'Code', null, false, 7],
        ['Column', 'Trips', 'Key', '\t', false, 7],
        ['Measure', 'Fleet', 'DeliveryTotal', 'Total deliveries', false, 7],
        ['Column', 'Fleet', 'InternalId', null, true, 7],
      ],
    })).mockResolvedValueOnce(analyzeDescriptions({ ...metadata, rows: [] }))
      .mockResolvedValueOnce(analyzeDescriptions({
        ...metadata,
        rows: [['Table', 'Deliveries', 'Deliveries', 'Delivery records', false, 1]],
      }));
    render(<App />);
    await connect();
    openTab('AI readiness');
    let checks = await screen.findByRole('table', { name: 'Readiness model checks' });
    const unscanned = within(checks).getByRole('row', { name: /Fleet.*North/ });
    expect(within(unscanned).getAllByRole('cell').slice(3, 6).map((cell) => cell.textContent))
      .toEqual(['Not scanned yet', 'Not scanned yet', 'Not scanned yet']);
    expect(source.scan).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Scan selected models' }));
    await screen.findByText('Scan finished. Review AI readiness or Description findings for each model outcome.');
    checks = screen.getByRole('table', { name: 'Readiness model checks' });
    const fleet = within(checks).getByRole('row', { name: /Fleet.*North/ });
    const deliveries = within(checks).getByRole('row', { name: /Deliveries.*South/ });
    const empty = within(checks).getByRole('row', { name: /Empty metadata.*North/ });
    expect(within(fleet).getAllByRole('cell').slice(3, 6).map((cell) => cell.textContent))
      .toEqual(['50%', '33.3%', '100%']);
    expect(within(deliveries).getAllByRole('cell').slice(3, 6).map((cell) => cell.textContent))
      .toEqual(['100%', 'N/A', 'N/A']);
    expect(within(empty).getAllByRole('cell').slice(3, 6).map((cell) => cell.textContent))
      .toEqual(['Needs review', 'Needs review', 'Needs review']);
    expect(within(screen.getByRole('region', { name: 'Table description coverage' })).getByText('66.7%')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Column description coverage' })).getByText('33.3%')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Measure description coverage' })).getByText('100%')).toBeVisible();
    expect(checks.compareDocumentPosition(screen.getByRole('img', { name: 'Description coverage chart' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(source.scan).toHaveBeenCalledTimes(3);
  });

  it('exposes keyboard coverage counts and returns focus after closing model details', async () => {
    render(<App />);
    await connect();
    fireEvent.click(screen.getByRole('button', { name: 'Scan selected models' }));
    await screen.findByText('Scan finished. Review AI readiness or Description findings for each model outcome.');
    openTab('AI readiness');
    const checks = await screen.findByRole('table', { name: 'Readiness model checks' });
    const fleet = within(checks).getByRole('row', { name: /Fleet.*North/ });
    await act(async () => within(fleet).getByRole('button', { name: 'Column descriptions: 0%' }).focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent('0 of 1 eligible columns described.');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());

    const deliveries = within(checks).getByRole('row', { name: /Deliveries.*South/ });
    const opener = within(deliveries).getByRole('button', { name: /Deliveries/ });
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Deliveries' });
    expect(dialog).toHaveAccessibleDescription('Workspace: South');
    expect(within(dialog).getByRole('button', { name: 'Close model details' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close model details' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());

    fireEvent.click(opener);
    await screen.findByRole('dialog', { name: 'Deliveries' });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
    expect(source.scan).toHaveBeenCalledTimes(2);
    expect(source.scanAIInstructions).toHaveBeenCalledTimes(2);
  });

  it('does not put a newly included workspace model under test, even when both model names match', async () => {
    source.discover.mockResolvedValue([
      { ...inventory[0], name: 'test', models: [{ ...northModel, name: 'Shared', workspaceName: 'test' }] },
      { ...inventory[1], name: 'Production', models: [{ ...southModel, name: 'Shared', workspaceName: 'Production' }] },
    ]);
    render(<App />);
    await connect();
    fireEvent.click(screen.getByRole('radio', { name: 'Choose workspaces' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Production workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Scan selected models' }));
    openTab('Description findings');
    await screen.findByRole('heading', { name: '2 objects need descriptions' });

    openTab('Workspaces & models');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Production workspace' }));
    const models = screen.getByRole('table', { name: 'Discovered semantic models' });
    const productionRow = within(models).getByRole('row', { name: /Shared.*Production/ });
    expect(within(productionRow).getByRole('cell', { name: 'Production' })).toBeVisible();
    openTab('Description findings');
    expect(screen.queryByRole('table', { name: 'Objects with missing descriptions' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Scan selected models' }));
    await screen.findByText('Scan finished. Review AI readiness or Description findings for each model outcome.');
    expect(screen.getByRole('tab', { name: 'Description findings' })).toHaveAttribute('aria-selected', 'true');
    const production = screen.getByRole('region', { name: 'Workspace: Production' });
    const test = screen.getByRole('region', { name: 'Workspace: test' });
    expect(within(production).getByText('Model: Shared / 2 missing descriptions')).toBeVisible();
    expect(within(test).getByText('Model: Shared / 2 missing descriptions')).toBeVisible();
    expect(source.scan.mock.calls.at(-1)?.[0]).toMatchObject({ workspaceId: 'south', workspaceName: 'Production' });
  });

  it('reports incomplete workspace discovery instead of counting a failed workspace as empty', async () => {
    source.discover.mockResolvedValue([
      inventory[0],
      { id: 'south', name: 'South', personal: false, status: 'error', error: 'Workspace access denied.' },
    ]);
    render(<App />);
    await connect();
    expect(screen.getByRole('alert')).toHaveTextContent('Workspace inventory is incomplete');
    expect(screen.getByRole('alert')).toHaveTextContent('Workspace access denied.');
    expect(screen.getByText('Unavailable')).toBeVisible();
    expect(screen.queryByText('0 models')).toBeNull();
    openTab('AI readiness');
    expect(await screen.findByRole('alert')).toHaveTextContent('Workspace inventory is incomplete');
    expect(source.scan).not.toHaveBeenCalled();
  });

  it('isolates model failures and clears old findings before a rescan', async () => {
    render(<App />);
    await connect();
    await scanAndExpand();
    source.scan.mockRejectedValueOnce(new Error('Read and Build access required.'));
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    expect(screen.getByRole('tab', { name: 'Description findings' })).toHaveAttribute('aria-selected', 'true');
    await screen.findByText('Model: Fleet / Scan failed');
    expect(screen.queryByRole('table', { name: 'Objects with missing descriptions' })).toBeNull();
    fireEvent.click(screen.getByText('Model: Fleet / Scan failed'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Read and Build access required.');
    expect(screen.getByText('Model: Deliveries / 2 missing descriptions')).toBeVisible();
  });

  it('stops queued scans when delegated sign-in expires', async () => {
    source.scan.mockRejectedValueOnce(new FabricReadAccessError('Reconnect the source account.'));
    render(<App />);
    await connect();
    fireEvent.click(screen.getByRole('button', { name: 'Scan selected models' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reconnect the source account.');
    expect(source.scan).toHaveBeenCalledOnce();
    openTab('Description findings');
    expect(screen.getByText('Model: Deliveries / Not scanned / stopped')).toBeVisible();
  });

  it('preserves description findings on an instruction error and checks instructions even if description acquisition fails', async () => {
    source.scan.mockRejectedValueOnce(new Error('Description object limit exceeded.'));
    source.scanAIInstructions
      .mockResolvedValueOnce({ status: 'present', reason: 'Nonblank AI instructions were found.' })
      .mockRejectedValueOnce(new Error('Linguistic metadata permission required.'));
    render(<App />);
    await connect();
    fireEvent.click(screen.getByRole('button', { name: 'Scan selected models' }));
    await screen.findByText('Scan finished. Review AI readiness or Description findings for each model outcome.');
    const checks = screen.getByRole('table', { name: 'Readiness model checks' });
    const fleet = within(checks).getByRole('row', { name: /Fleet.*North/ });
    const deliveries = within(checks).getByRole('row', { name: /Deliveries.*South/ });
    expect(within(fleet).getByRole('cell', { name: 'Present' })).toBeVisible();
    expect(within(fleet).getByRole('cell', { name: 'Scan failed' })).toBeVisible();
    expect(within(deliveries).getByRole('cell', { name: 'Scanned' })).toBeVisible();
    fireEvent.click(within(deliveries).getByRole('button', { name: /Deliveries/ }));
    expect(screen.getByRole('region', { name: 'Readiness evidence: Deliveries in South' }))
      .toHaveTextContent('Linguistic metadata permission required.');
    fireEvent.click(screen.getByRole('button', { name: 'Close model details' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(source.scanAIInstructions.mock.calls.map(([model]) => model)).toEqual([northModel, southModel]);
    openTab('Description findings');
    expect(screen.getByText('Model: Deliveries / 2 missing descriptions')).toBeVisible();
  });

  it('stops the remaining queue if instruction acquisition loses source authentication', async () => {
    source.scanAIInstructions.mockRejectedValueOnce(new FabricReadAccessError('Reconnect to read instructions.'));
    render(<App />);
    await connect();
    fireEvent.click(screen.getByRole('button', { name: 'Scan selected models' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reconnect to read instructions.');
    expect(source.scan).toHaveBeenCalledOnce();
    expect(source.scanAIInstructions).toHaveBeenCalledOnce();
    openTab('Description findings');
    expect(screen.getByText('Model: Fleet / 2 missing descriptions')).toBeVisible();
    expect(screen.getByText('Model: Deliveries / Not scanned / stopped')).toBeVisible();
  });

  it('discards instruction completion after a scan is stopped', async () => {
    let finish!: (value: { status: 'present'; reason: string }) => void;
    source.scanAIInstructions.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    await connect();
    fireEvent.click(screen.getByRole('button', { name: 'Scan selected models' }));
    await waitFor(() => expect(source.scanAIInstructions).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Stop scan' }));
    await act(async () => { finish({ status: 'present', reason: 'Late instruction result.' }); });
    expect(source.scan).toHaveBeenCalledOnce();
    const checks = screen.getByRole('table', { name: 'Readiness model checks' });
    expect(within(checks).queryByRole('cell', { name: 'Present' })).toBeNull();
    openTab('Description findings');
    expect(screen.getByText('Model: Fleet / Not scanned / stopped')).toBeVisible();
  });

  it('clears findings and source inventory when changing the connected Microsoft account', async () => {
    render(<App />);
    await connect();
    await scanAndExpand();
    source.connect.mockResolvedValueOnce('other@example.invalid');
    source.discover.mockResolvedValueOnce([inventory[1]]);
    openTab('Workspaces & models');
    fireEvent.click(screen.getByRole('button', { name: 'Change account' }));
    expect(await screen.findByText('Connected as other@example.invalid')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Select Fleet model in North' })).toBeNull());
    openTab('Description findings');
    expect(screen.queryByRole('table', { name: 'Objects with missing descriptions' })).toBeNull();
  });

  it('preserves model choices but clears findings when refreshing the live inventory', async () => {
    render(<App />);
    await connect();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Deliveries model in South' }));
    fireEvent.click(screen.getByRole('button', { name: 'Scan selected models' }));
    openTab('Description findings');
    await screen.findByRole('heading', { name: '2 objects need descriptions' });
    openTab('Workspaces & models');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh inventory' }));
    await waitFor(() => expect(source.discover).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select Fleet model in North' })).toBeChecked());
    expect(screen.getByRole('checkbox', { name: 'Select Deliveries model in South' })).not.toBeChecked();
    openTab('Description findings');
    expect(screen.queryByRole('table', { name: 'Objects with missing descriptions' })).toBeNull();
    expect(source.scan).toHaveBeenCalledOnce();
  });

  it('stops queued models and ignores the active completion when a scan is stopped', async () => {
    let finish!: (scan: DescriptionScan) => void;
    source.scan.mockImplementationOnce(() => new Promise<DescriptionScan>((resolve) => { finish = resolve; }));
    render(<App />);
    await connect();
    fireEvent.click(screen.getByRole('button', { name: 'Scan selected models' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop scan' }));
    await act(async () => { finish(descriptionScan); });
    expect(source.scan).toHaveBeenCalledOnce();
    openTab('Description findings');
    expect(screen.queryByRole('table', { name: 'Objects with missing descriptions' })).toBeNull();
    expect(screen.getByText('Model: Deliveries / Not scanned / stopped')).toBeVisible();
  });

  it.each(['principal', 'opaque'])('discards an in-flight result after the %s authentication boundary changes', async (kind) => {
    let finish!: (scan: DescriptionScan) => void;
    source.scan.mockImplementationOnce(() => new Promise<DescriptionScan>((resolve) => { finish = resolve; }));
    const first = authenticated('first');
    if (kind === 'opaque') first.session = { user: null, isAuthenticated: true, isAnonymous: false };
    const view = (value: AuthContextValue) => <AuthContext.Provider value={value}><AuthGate><App /></AuthGate></AuthContext.Provider>;
    const { rerender } = render(view(first));
    await connect();
    fireEvent.click(screen.getByRole('button', { name: 'Scan selected models' }));
    await waitFor(() => expect(source.scan).toHaveBeenCalledOnce());
    const signal: AbortSignal = source.scan.mock.calls[0][1];
    rerender(view(kind === 'principal' ? authenticated('second') : { ...first, session: { ...first.session! } }));
    await act(async () => { finish(descriptionScan); });
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole('table', { name: 'Objects with missing descriptions' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Select Fleet model in North' })).toBeNull();
    expect(source.scan).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalled();
  });

  it('preserves current results across a same-principal session refresh', async () => {
    const view = () => <AuthContext.Provider value={authenticated('same')}><AuthGate><App /></AuthGate></AuthContext.Provider>;
    const { rerender } = render(view());
    await connect();
    await scanAndExpand();
    rerender(view());
    expect(screen.getByRole('table', { name: 'Objects with missing descriptions' })).toBeVisible();
    expect(factory).toHaveBeenCalledOnce();
  });

  it('can reopen a closed popup immediately without a cancelled attempt clearing the replacement sign-in', async () => {
    let cancelPrevious!: (error: Error) => void;
    let finishRetry!: (account: string) => void;
    source.connect
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { cancelPrevious = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishRetry = resolve; }));
    render(<App />);
    const connectButton = screen.getByRole('button', { name: 'Connect workspaces' });
    await waitFor(() => expect(connectButton).toBeEnabled());
    fireEvent.click(connectButton);

    const reopenButton = screen.getByRole('button', { name: 'Reopen sign-in' });
    expect(reopenButton).toBeEnabled();
    expect(reopenButton).toHaveAccessibleDescription(/Close any earlier sign-in window/);
    expect(screen.getByRole('button', { name: 'Scan selected models' })).toBeDisabled();
    expect(source.discover).not.toHaveBeenCalled();
    fireEvent.click(reopenButton);
    expect(source.connect.mock.calls).toEqual([[false], [true]]);

    await act(async () => { cancelPrevious(new Error('Previous popup interaction cancelled.')); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Complete Microsoft sign-in in the popup...')).toBeVisible();
    expect(reopenButton).toBeEnabled();
    expect(source.discover).not.toHaveBeenCalled();

    await act(async () => { finishRetry('scanner@example.invalid'); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Scan selected models' })).toBeEnabled());
    expect(source.discover).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Reopen sign-in' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(source.scan).not.toHaveBeenCalled();
  });

  it('offers an explicit sign-in retry after a failed popup and clears the error after connecting', async () => {
    source.connect.mockRejectedValueOnce(new FabricReadAccessError('Previous Microsoft sign-in is still pending. Reopen sign-in to try again.'));
    render(<App />);
    const button = screen.getByRole('button', { name: 'Connect workspaces' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('Previous Microsoft sign-in is still pending.');
    const reopenButton = screen.getByRole('button', { name: 'Reopen sign-in' });
    expect(reopenButton).toBeEnabled();
    expect(source.connect).toHaveBeenCalledOnce();
    expect(source.discover).not.toHaveBeenCalled();
    fireEvent.click(reopenButton);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Scan selected models' })).toBeEnabled());
    expect(source.connect.mock.calls).toEqual([[false], [true]]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Change account' })).toBeEnabled();
  });

  it('surfaces sign-in and sign-out errors without fabricating a catalog', async () => {
    source.connect.mockRejectedValueOnce(new Error('Microsoft consent was declined.'));
    signOut.mockRejectedValueOnce(new Error('Session service unavailable.'));
    render(<App />);
    const button = screen.getByRole('button', { name: 'Connect workspaces' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('Microsoft consent was declined.');
    expect(screen.queryByText('Complete Microsoft sign-in in the popup...')).toBeNull();
    expect(button).toBeEnabled();
    expect(source.discover).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    expect(screen.getByText('Sign-out failed: Session service unavailable.')).toBeVisible();
  });
});
