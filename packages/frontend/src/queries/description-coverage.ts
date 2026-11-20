import type { VisualizationSpec } from '@microsoft/fabric-visuals';
import type { ReadinessReport } from '@/lib/model-readiness';
import { toDataTable, type ColumnMetadataMap } from '@/lib/to-data-table';
import spec from './description-coverage.json';

export const descriptionCoverageSpec: VisualizationSpec = spec as VisualizationSpec;

const columnMetadata: ColumnMetadataMap = {
  ObjectType: { name: 'ObjectType', displayName: 'Object type' },
  Status: { name: 'Status', displayName: 'Description status' },
  Coverage: { name: 'Coverage', displayName: 'Coverage', format: '0%' },
  Count: { name: 'Count', displayName: 'Objects', format: '#,0' },
  Total: { name: 'Total', displayName: 'Eligible objects', format: '#,0' },
  StatusOrder: { name: 'StatusOrder' },
};

export function descriptionCoverage(report: ReadinessReport) {
  return toDataTable({
    columns: Object.keys(columnMetadata).map((name) => ({ name })),
    rows: report.groups.filter((group) => group.total > 0).flatMap((group) => [
      [`${group.kind}s`, 'Described', group.documented / group.total, group.documented, group.total, 0],
      [`${group.kind}s`, 'Missing', (group.total - group.documented) / group.total, group.total - group.documented, group.total, 1],
    ]),
  }, columnMetadata);
}
