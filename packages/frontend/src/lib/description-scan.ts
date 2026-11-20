import type { QueryTable } from '@microsoft/rayfin-connector-fabric-semanticmodel';

export const PILOT_OBJECT_LIMIT = 2_000;

const kinds = ['Table', 'Column', 'Measure'] as const;
type DescriptionKind = (typeof kinds)[number];

interface DescriptionObject {
  id: string;
  kind: DescriptionKind;
  tableName: string;
  name: string;
  hidden: boolean;
  documented: boolean;
}

export interface DescriptionScan {
  acquired: number;
  excludedHidden: number;
  summary: { kind: DescriptionKind; total: number; documented: number }[];
  missing: DescriptionObject[];
}

export function analyzeDescriptions(table: QueryTable): DescriptionScan {
  const positions = new Map(table.columns.map((column, index) => [column.name, index]));
  const fields = [
    '[ObjectType]', '[TableName]', '[ObjectName]', '[Description]',
    '[IsHidden]', '[ExpectedObjectCount]',
  ];
  if (positions.size !== table.columns.length || fields.some((field) => !positions.has(field))) {
    throw new Error('The metadata response has an unexpected schema. No findings were calculated.');
  }

  function cell(row: unknown[], field: string): unknown {
    const index = positions.get(field);
    if (index === undefined) throw new Error(`The metadata response is missing ${field}.`);
    return row[index];
  }

  if (table.rows.length > 0) {
    const expected = cell(table.rows[0], '[ExpectedObjectCount]');
    if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 1) {
      throw new Error('The source did not return a valid metadata count. No findings were calculated.');
    }
    if (expected > PILOT_OBJECT_LIMIT || table.rows.length > PILOT_OBJECT_LIMIT) {
      throw new Error('Each model scan supports up to 2,000 metadata objects. The model exceeds that limit; no partial findings are shown.');
    }
    if (expected !== table.rows.length) {
      throw new Error('The metadata response is incomplete. No findings or coverage totals were calculated.');
    }
  }

  const identities = new Set<string>();
  const objects = table.rows.map((row): DescriptionObject => {
    const kind = cell(row, '[ObjectType]');
    const tableName = cell(row, '[TableName]');
    const name = cell(row, '[ObjectName]');
    const description = cell(row, '[Description]');
    const hidden = cell(row, '[IsHidden]');
    if (
      row.length !== table.columns.length ||
      (kind !== 'Table' && kind !== 'Column' && kind !== 'Measure') ||
      typeof tableName !== 'string' || !tableName.trim() ||
      typeof name !== 'string' || !name.trim() ||
      (description !== null && typeof description !== 'string') ||
      typeof hidden !== 'boolean' ||
      cell(row, '[ExpectedObjectCount]') !== table.rows.length ||
      (kind === 'Table' && name !== tableName)
    ) {
      throw new Error('The source returned invalid or inconsistent object metadata. No findings were calculated.');
    }
    const id = JSON.stringify([kind, tableName, name]);
    if (identities.has(id)) {
      throw new Error('The metadata response contains duplicate objects. No findings were calculated.');
    }
    identities.add(id);
    return {
      id, kind, tableName, name, hidden,
      documented: description !== null && description.trim().length > 0,
    };
  });

  const tables = new Map(objects.filter((object) => object.kind === 'Table')
    .map((object) => [object.name, object]));
  const eligible = objects.filter((object) => {
    if (object.kind === 'Table') return !object.hidden;
    const parent = tables.get(object.tableName);
    if (!parent) {
      throw new Error('The metadata response is missing a parent table. No findings were calculated.');
    }
    return !object.hidden && !parent.hidden;
  });

  return {
    acquired: objects.length,
    excludedHidden: objects.length - eligible.length,
    summary: kinds.map((kind) => {
      const group = eligible.filter((object) => object.kind === kind);
      return { kind, total: group.length, documented: group.filter((object) => object.documented).length };
    }),
    missing: eligible.filter((object) => !object.documented),
  };
}
