import type { QueryTable } from '@microsoft/rayfin-connector-fabric-semanticmodel';
import { describe, expect, it } from 'vitest';

import { analyzeDescriptions } from './description-scan';

function inventory(rows: unknown[][]): QueryTable {
  return {
    columns: [
      { name: '[ObjectType]', dataType: 'String' },
      { name: '[TableName]', dataType: 'String' },
      { name: '[ObjectName]', dataType: 'String' },
      { name: '[Description]', dataType: 'String' },
      { name: '[IsHidden]', dataType: 'Boolean' },
      { name: '[ExpectedObjectCount]', dataType: 'Int64' },
    ],
    rows: rows.map((row) => [...row, rows.length]),
  };
}

describe('description scan', () => {
  it('finds blank descriptions and excludes hidden objects and children of hidden tables', () => {
    const scan = analyzeDescriptions(inventory([
      ['Table', 'Fleet', 'Fleet', 'Vehicles', false],
      ['Column', 'Fleet', 'Id', 'Vehicle identifier', false],
      ['Column', 'Fleet', 'Name', null, false],
      ['Column', 'Fleet', 'Notes', ' \t\n\u00a0 ', false],
      ['Column', 'Fleet', 'InternalId', null, true],
      ['Measure', 'Fleet', 'Total', null, false],
      ['Table', 'Hidden', 'Hidden', null, true],
      ['Column', 'Hidden', 'Child', null, false],
    ]));

    expect(scan.acquired).toBe(8);
    expect(scan.excludedHidden).toBe(3);
    expect(scan.missing.map((object) => object.name)).toEqual(['Name', 'Notes', 'Total']);
    expect(scan.summary).toEqual([
      { kind: 'Table', total: 1, documented: 1 },
      { kind: 'Column', total: 3, documented: 1 },
      { kind: 'Measure', total: 1, documented: 0 },
    ]);
  });

  it('accepts 2000 objects but rejects a 2001-object inventory', () => {
    const rows = Array.from({ length: 2000 }, (_, index) =>
      ['Table', `Table${index}`, `Table${index}`, null, false]);
    expect(analyzeDescriptions(inventory(rows)).missing).toHaveLength(2000);
    rows.push(['Table', 'Extra', 'Extra', null, false]);
    expect(() => analyzeDescriptions(inventory(rows))).toThrow('exceeds that limit');
  });

  it('does not turn a silently truncated response into complete findings', () => {
    const table = inventory([
      ['Table', 'Fleet', 'Fleet', null, false],
      ['Column', 'Fleet', 'Id', null, false],
    ]);
    table.rows.pop();
    expect(() => analyzeDescriptions(table)).toThrow('incomplete');
  });

  it('rejects a changed schema instead of treating absent fields as blank descriptions', () => {
    const table = inventory([['Table', 'Fleet', 'Fleet', null, false]]);
    table.columns[3] = { name: '[Unexpected]', dataType: 'String' };
    expect(() => analyzeDescriptions(table)).toThrow('unexpected schema');
  });

  it('rejects objects without their parent table', () => {
    expect(() => analyzeDescriptions(inventory([
      ['Column', 'Fleet', 'Id', null, false],
    ]))).toThrow('missing a parent table');
  });

  it('rejects duplicate object rows rather than counting them twice', () => {
    expect(() => analyzeDescriptions(inventory([
      ['Table', 'Fleet', 'Fleet', null, false],
      ['Table', 'Fleet', 'Fleet', null, false],
    ]))).toThrow('duplicate objects');
  });
});
