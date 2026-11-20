import { describe, expect, it } from 'vitest';
import type { QueryTable } from '@microsoft/rayfin-connector-fabric-semanticmodel';
import type { ModelScanResult } from '@/hooks/use-workspace-scanner';
import { analyzeDescriptions } from './description-scan';
import { analyzeAIInstructions } from './ai-instructions';
import type { SemanticModel } from './fabric-discovery';
import { buildReadinessReport, formatCoverage } from './model-readiness';
import { descriptionCoverage } from '@/queries/description-coverage';

const north: SemanticModel = { id: 'model', name: 'Shared', workspaceId: 'north', workspaceName: 'North', descriptionStatus: 'present' };
const south: SemanticModel = { ...north, workspaceId: 'south', workspaceName: 'South', descriptionStatus: 'missing' };

function success(model: SemanticModel, columns: (string | null)[], measures: (string | null)[] = [], hidden = false): ModelScanResult {
  const objects = [
    ['Table', 'Entities', 'Entities', 'Business entities', false],
    ...columns.map((description, index) => ['Column', 'Entities', `Field${index}`, description, false]),
    ...measures.map((description, index) => ['Measure', 'Entities', `Measure${index}`, description, false]),
    ...(hidden ? [['Column', 'Entities', 'Internal', null, true]] : []),
  ];
  const table: QueryTable = {
    columns: [
      { name: '[ObjectType]', dataType: 'String' }, { name: '[TableName]', dataType: 'String' },
      { name: '[ObjectName]', dataType: 'String' }, { name: '[Description]', dataType: 'String' },
      { name: '[IsHidden]', dataType: 'Boolean' }, { name: '[ExpectedObjectCount]', dataType: 'Int64' },
    ],
    rows: objects.map((row) => [...row, objects.length]),
  };
  return { model, status: 'success', scan: analyzeDescriptions(table) };
}

describe('scoped model readiness evidence', () => {
  it('weights eligible field counts, excludes hidden objects, and retains same-named model identities', () => {
    const report = buildReadinessReport([north, south], [
      success(north, ['Documented', null, null], ['Documented'], true),
      success(south, ['Documented']),
    ]);
    expect(report.fields).toEqual({ documented: 3, total: 5, ratio: 0.6 });
    expect(report.contributing).toBe(2);
    expect(report.excludedHidden).toBe(1);
    expect(report.entries.map((entry) => [entry.key, entry.model.workspaceName, entry.fields?.ratio, entry.modelDescription]))
      .toEqual([['north:model', 'North', 0.5, 'Pass'], ['south:model', 'South', 1, 'Fail']]);
    expect(report.entries.every((entry) => entry.aiInstructions === 'Review')).toBe(true);
    const chart = descriptionCoverage(report);
    expect(chart.rows).toContainEqual(['Columns', 'Described', 0.5, 2, 4, 0]);
    expect(chart.rows).toContainEqual(['Measures', 'Described', 1, 1, 1, 0]);
  });

  it('keeps no metadata and incomplete scans as Review instead of inventing coverage or applicability', () => {
    const models = Array.from({ length: 6 }, (_, index) => ({
      ...north, id: `model-${index}`, descriptionStatus: undefined,
    }));
    const inspected = success(models[0], []);
    const report = buildReadinessReport(models, [
      inspected,
      { model: models[1], status: 'success', scan: { acquired: 0, excludedHidden: 0, summary: [], missing: [] } },
      { model: models[2], status: 'error', error: 'Build permission required.' },
      { model: models[3], status: 'cancelled' },
      { model: models[4], status: 'reading' },
    ]);
    expect(report.contributing).toBe(1);
    expect(report.fields).toEqual({ documented: 0, total: 0, ratio: null });
    expect(report.entries[0].fields?.ratio).toBeNull();
    expect(report.entries.slice(1).every((entry) => entry.fields === null && entry.coverage === null)).toBe(true);
    expect(report.entries.map((entry) => entry.scanStatus)).toEqual([
      'Scanned', 'Review', 'Scan failed', 'Stopped', 'Reading metadata', 'Not scanned',
    ]);
    expect(report.entries[2].scanReason).toBe('Build permission required.');
    expect(report.entries.every((entry) => entry.modelDescription === 'Review')).toBe(true);
    expect(descriptionCoverage(report).rows).toHaveLength(2);
  });

  it('never rounds incomplete coverage into a perfect or completely missing result', () => {
    expect(formatCoverage(99_999 / 100_000)).toBe('<100%');
    expect(formatCoverage(1 / 100_000)).toBe('>0%');
    expect(formatCoverage(1)).toBe('100%');
    expect(formatCoverage(0)).toBe('0%');
    expect(formatCoverage(null)).toBe('N/A');
  });

  it('keeps instruction evidence independent of description failures', () => {
    const report = buildReadinessReport([north, south], [
      { model: north, status: 'error', error: 'Object limit exceeded.', aiInstructions: { status: 'present', reason: 'Instructions found.' } },
      { ...success(south, ['Documented']), aiInstructions: { status: 'error', reason: 'Metadata access denied.' } },
    ]);
    expect(report.contributing).toBe(1);
    expect(report.instructions).toEqual({ present: 1, missing: 0, review: 1 });
    expect(report.entries[0]).toMatchObject({ fields: null, aiInstructions: 'Pass' });
    expect(report.entries[1]).toMatchObject({ aiInstructions: 'Review', aiInstructionsReason: 'Metadata access denied.' });
    expect(report.fields.ratio).toBe(1);
  });
});

function linguisticMetadata(documents: unknown[]): QueryTable {
  const contents = documents.map((document) => typeof document === 'string' ? document : JSON.stringify(document));
  return {
    columns: ['[CultureId]', '[Content]', '[ContentLength]', '[ExpectedMetadataCount]']
      .map((name) => ({ name, dataType: 'unknown' })),
    rows: [
      [null, null, null, documents.length],
      ...contents.map((content, index) => [`culture-${index}`, content, content.length, documents.length]),
    ],
  };
}

describe('AI-instruction presence from returned linguistic metadata', () => {
  const schema = { Version: '4.2.0', Language: 'en-US' };

  it.each(['2.0.0', '4.2.0'])('recognizes nonblank instructions in version %s without retaining their text', (Version) => {
    const result = analyzeAIInstructions(linguisticMetadata([
      { ...schema, Version, CustomInstructions: 'Use the approved revenue measure.' },
      { ...schema, Language: 'fr-FR', CustomInstructions: '  ' },
    ]));
    expect(result).toMatchObject({ status: 'present', reason: expect.stringContaining('1 of 2') });
    expect(JSON.stringify(result)).not.toContain('approved revenue measure');
  });

  it.each([undefined, '', '\t '])('reports missing instructions only for an inspected recognized document (%s)', (CustomInstructions) => {
    const result = analyzeAIInstructions(linguisticMetadata([{
      ...schema, CustomInstructions, Description: 'A catalog description does not count.',
    }]));
    expect(result.status).toBe('missing');
  });

  it('keeps empty, oversized, over-limit, and unsupported-version metadata inconclusive', () => {
    expect(analyzeAIInstructions(linguisticMetadata([])).status).toBe('review');
    expect(analyzeAIInstructions(linguisticMetadata([{ ...schema, Version: '99.0.0', CustomInstructions: 'Present' }])).status).toBe('review');
    const oversized = linguisticMetadata([schema]);
    oversized.rows[1][1] = null;
    oversized.rows[1][2] = 262_145;
    expect(analyzeAIInstructions(oversized).status).toBe('review');
    const overLimit = linguisticMetadata(Array.from({ length: 17 }, () => schema));
    expect(analyzeAIInstructions(overLimit).status).toBe('review');
  });

  it('rejects truncated or malformed content and inconsistent counts rather than reporting missing instructions', () => {
    expect(() => analyzeAIInstructions(linguisticMetadata(['{"Version":"4.2.0",']))).toThrow('not valid JSON');
    expect(() => analyzeAIInstructions(linguisticMetadata([{ ...schema, CustomInstructions: true }]))).toThrow('unexpected type');
    const incomplete = linguisticMetadata([schema]);
    incomplete.rows.pop();
    expect(() => analyzeAIInstructions(incomplete)).toThrow('incomplete');
    const inconsistent = linguisticMetadata([schema]);
    inconsistent.rows[1][3] = 2;
    expect(() => analyzeAIInstructions(inconsistent)).toThrow('invalid metadata count');
  });
});
