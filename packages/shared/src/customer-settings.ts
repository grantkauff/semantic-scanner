export type ExpressionStorage = 'none' | 'authorized-only';

export interface CustomerSettings {
  readonly formatVersion: 1;
  readonly retentionDays: number;
  readonly expressionStorage: ExpressionStorage;
}

export interface CustomerSettingsInput {
  readonly retentionDays: string;
  readonly expressionStorage: string;
}

export type SettingsIssues = Partial<Record<keyof CustomerSettingsInput, string>>;

export type SettingsResult =
  | { readonly ok: true; readonly settings: CustomerSettings }
  | { readonly ok: false; readonly issues: SettingsIssues };

export function parseCustomerSettings(input: CustomerSettingsInput): SettingsResult {
  const issues: SettingsIssues = {};
  const days = input.retentionDays.trim();
  const retentionDays = Number(days);

  if (!/^\d+$/.test(days) || !Number.isSafeInteger(retentionDays) || retentionDays < 1) {
    issues.retentionDays = 'Enter a positive whole number of retention days.';
  }

  const expressionStorage = input.expressionStorage;
  if (expressionStorage !== 'none' && expressionStorage !== 'authorized-only') {
    issues.expressionStorage = 'Explicitly choose whether authorized expressions may be retained.';
    return { ok: false, issues };
  }

  if (Object.keys(issues).length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    settings: { formatVersion: 1, retentionDays, expressionStorage },
  };
}
