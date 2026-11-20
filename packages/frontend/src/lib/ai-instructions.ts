import type { QueryTable } from '@microsoft/rayfin-connector-fabric-semanticmodel';

export interface AIInstructionsCheck {
  status: 'present' | 'missing' | 'review' | 'error';
  reason: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function analyzeAIInstructions(table: QueryTable): AIInstructionsCheck {
  const fields = ['[CultureId]', '[Content]', '[ContentLength]', '[ExpectedMetadataCount]'];
  const positions = fields.map((field) => table.columns.findIndex((column) => column.name === field));
  if (
    table.columns.length !== fields.length || positions.some((position) => position < 0) ||
    table.rows.length < 1 || table.rows.some((row) => row.length !== fields.length)
  ) throw new Error('The AI-instructions response has an unexpected schema. No presence result was calculated.');

  const [culturePosition, contentPosition, lengthPosition, countPosition] = positions;
  const header = table.rows.filter((row) => row[culturePosition] === null);
  if (header.length !== 1 || header[0][contentPosition] !== null || header[0][lengthPosition] !== null) {
    throw new Error('The AI-instructions response is missing its metadata-count record. Scan again.');
  }
  const count = header[0][countPosition];
  if (
    typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 ||
    table.rows.some((row) => row[countPosition] !== count)
  ) throw new Error('The AI-instructions response has an invalid metadata count. No presence result was calculated.');
  if (count > 16) {
    return { status: 'review', reason: 'The model exceeds the 16-culture inspection limit. Verify AI instructions in Prep data for AI; a partial response is not a missing setting.' };
  }
  if (table.rows.length !== count + 1) {
    throw new Error('The AI-instructions response is incomplete. No presence result was calculated.');
  }
  if (count === 0) {
    return { status: 'review', reason: 'Power BI returned no linguistic metadata to this account. This does not prove instructions are missing. Check metadata permissions and Prep data for AI.' };
  }

  const cultures = new Set<string>();
  let present = 0;
  for (const row of table.rows) {
    const culture = row[culturePosition];
    if (culture === null) continue;
    const content = row[contentPosition];
    const length = row[lengthPosition];
    if (
      typeof culture !== 'string' || !culture.trim() || cultures.has(culture) ||
      typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0
    ) throw new Error('Power BI returned invalid or duplicate linguistic metadata. No presence result was calculated.');
    cultures.add(culture);
    if (length > 262_144) {
      return { status: 'review', reason: 'Linguistic metadata exceeds the 262,144-character per-culture limit. Its content was not acquired. Verify AI instructions in Prep data for AI.' };
    }
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Power BI returned blank or incomplete linguistic content. No presence result was calculated.');
    }
    let document: unknown;
    try {
      document = JSON.parse(content);
    } catch {
      throw new Error('Linguistic metadata is not valid JSON. Verify AI instructions in Prep data for AI.');
    }
    if (
      !record(document) || (document.Version !== '4.2.0' && document.Version !== '2.0.0') ||
      typeof document.Language !== 'string' || !document.Language.trim()
    ) {
      return { status: 'review', reason: 'The linguistic metadata format or version is not recognized. Verify AI instructions in Prep data for AI; no missing-setting result was inferred.' };
    }
    const instructions = document.CustomInstructions;
    if (instructions !== undefined && typeof instructions !== 'string') {
      throw new Error('The AI-instructions property has an unexpected type. Verify it in Prep data for AI.');
    }
    if (typeof instructions === 'string' && instructions.trim()) present++;
  }
  return present > 0
    ? { status: 'present', reason: `Nonblank AI instructions were found in ${present} of ${count} returned cultures. Instruction text is not retained; presence does not assess quality.` }
    : { status: 'missing', reason: `No nonblank AI instructions were found in the ${count} returned cultures. Add them in Prep data for AI. This result applies only to metadata visible to this account.` };
}
