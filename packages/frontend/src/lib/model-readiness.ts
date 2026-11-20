import type { ModelScanResult } from '@/hooks/use-workspace-scanner';
import type { DescriptionScan } from './description-scan';
import { modelKey, type SemanticModel } from './fabric-discovery';

export interface DescriptionCoverage {
  total: number;
  documented: number;
  ratio: number | null;
}

export interface ReadinessModel {
  key: string;
  model: SemanticModel;
  scanStatus: 'Not scanned' | 'Scanned' | 'Review' | 'Scan failed' | 'Stopped' | 'Reading metadata' | 'Waiting';
  scanReason: string;
  coverage: DescriptionScan['summary'] | null;
  fields: DescriptionCoverage | null;
  excludedHidden: number | null;
  modelDescription: 'Pass' | 'Fail' | 'Review';
  aiInstructions: 'Pass' | 'Fail' | 'Review';
  aiInstructionsReason: string;
}

function coverageRatio(documented: number, total: number): number | null {
  return total === 0 ? null : documented / total;
}

export function formatCoverage(ratio: number | null): string {
  if (ratio === null) return 'N/A';
  const rounded = Math.round(ratio * 1_000) / 10;
  if (ratio < 1 && rounded === 100) return '<100%';
  if (ratio > 0 && rounded === 0) return '>0%';
  return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(ratio);
}

export function buildReadinessReport(models: SemanticModel[], results: ModelScanResult[]) {
  const byModel = new Map(results.map((result) => [modelKey(result.model), result]));
  const entries: ReadinessModel[] = models.map((model) => {
    const result = byModel.get(modelKey(model));
    const instructions = result?.aiInstructions;
    const scan = result?.status === 'success' && result.scan.acquired > 0 ? result.scan : null;
    const fields = scan?.summary.filter((group) => group.kind === 'Column' || group.kind === 'Measure')
      .reduce((sum, group) => ({ total: sum.total + group.total, documented: sum.documented + group.documented }), { total: 0, documented: 0 });
    let scanStatus: ReadinessModel['scanStatus'] = 'Not scanned';
    let scanReason = 'Run a description scan to inspect eligible fields.';
    if (result?.status === 'success') {
      scanStatus = scan ? 'Scanned' : 'Review';
      scanReason = scan
        ? 'Complete returned metadata only; hidden objects and objects in hidden tables are excluded.'
        : 'No metadata was returned. This does not establish that the model is empty.';
    } else if (result?.status === 'error') {
      scanStatus = 'Scan failed';
      scanReason = result.error;
    } else if (result?.status === 'reading' || result?.status === 'pending') {
      scanStatus = result.status === 'reading' ? 'Reading metadata' : 'Waiting';
      scanReason = 'Coverage is unavailable until this model finishes successfully.';
    } else if (result?.status === 'cancelled') {
      scanStatus = 'Stopped';
      scanReason = 'This model did not complete. No coverage was calculated.';
    }
    return {
      key: modelKey(model), model, scanStatus, scanReason,
      coverage: scan?.summary ?? null,
      fields: fields ? { ...fields, ratio: coverageRatio(fields.documented, fields.total) } : null,
      excludedHidden: scan?.excludedHidden ?? null,
      modelDescription: model.descriptionStatus === 'present' ? 'Pass' : model.descriptionStatus === 'missing' ? 'Fail' : 'Review',
      aiInstructions: instructions?.status === 'present' ? 'Pass' : instructions?.status === 'missing' ? 'Fail' : 'Review',
      aiInstructionsReason: instructions?.reason ?? 'Not inspected yet. Run Scan selected models to check AI instructions separately from descriptions.',
    };
  });
  const contributing = entries.filter((entry) => entry.coverage !== null);
  const groups = (['Table', 'Column', 'Measure'] as const).map((kind) => {
    const totals = contributing.flatMap((entry) => entry.coverage ?? [])
      .filter((group) => group.kind === kind)
      .reduce((sum, group) => ({ total: sum.total + group.total, documented: sum.documented + group.documented }), { total: 0, documented: 0 });
    return { kind, ...totals, ratio: coverageRatio(totals.documented, totals.total) };
  });
  const fields = groups.filter((group) => group.kind !== 'Table')
    .reduce((sum, group) => ({ total: sum.total + group.total, documented: sum.documented + group.documented }), { total: 0, documented: 0 });
  return {
    entries, groups, contributing: contributing.length,
    instructions: {
      present: entries.filter((entry) => entry.aiInstructions === 'Pass').length,
      missing: entries.filter((entry) => entry.aiInstructions === 'Fail').length,
      review: entries.filter((entry) => entry.aiInstructions === 'Review').length,
    },
    fields: { ...fields, ratio: coverageRatio(fields.documented, fields.total) },
    excludedHidden: contributing.reduce((sum, entry) => sum + (entry.excludedHidden ?? 0), 0),
  };
}

export type ReadinessReport = ReturnType<typeof buildReadinessReport>;
