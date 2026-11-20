import { useId, useState, type FormEvent } from 'react';
import { Download } from 'lucide-react';
import {
  parseCustomerSettings,
  type CustomerSettingsInput,
  type SettingsIssues,
} from '@rayfin-app/shared';

export function CustomerSettingsForm() {
  const id = useId();
  const [input, setInput] = useState<CustomerSettingsInput>({
    retentionDays: '',
    expressionStorage: '',
  });
  const [issues, setIssues] = useState<SettingsIssues>({});
  const [requested, setRequested] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);

  function update(field: keyof CustomerSettingsInput, value: string) {
    setInput((current) => ({ ...current, [field]: value }));
    setRequested(false);
    setDownloadError(null);
    setDraft(null);
  }

  function downloadDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequested(false);
    setDownloadError(null);
    setDraft(null);
    const result = parseCustomerSettings(input);
    if (!result.ok) {
      setIssues(result.issues);
      return;
    }

    setIssues({});
    const json = `${JSON.stringify(result.settings, null, 2)}\n`;
    setDraft(json);
    let url: string | undefined;
    const link = document.createElement('a');
    try {
      url = URL.createObjectURL(
        new Blob([json], { type: 'application/json' })
      );
      link.href = url;
      link.download = 'semantic-scanner.settings.json';
      document.body.append(link);
      link.click();
      setRequested(true);
    } catch (error) {
      setDownloadError(
        `Configuration download could not start: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      link.remove();
      if (url) URL.revokeObjectURL(url);
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-2xl border border-border bg-card p-600">
      <h2 id={`${id}-title`} className="font-heading text-500 leading-500">Saved scan privacy</h2>
      <p className="mt-300 text-200 leading-300 text-muted-foreground">
        For administrators preparing future saved scan history. Both choices must
        be explicit before deployment. This form only creates a draft; no model
        evidence is stored today.
      </p>
      <form aria-label="Customer data-handling settings" noValidate onSubmit={downloadDraft} className="mt-500 space-y-500">
        <div>
          <label htmlFor={`${id}-retention`} className="mb-200 block font-semibold">Retention in days</label>
          <input id={`${id}-retention`} type="number" min="1" step="1" inputMode="numeric"
            className="h-control w-full rounded-lg border border-input bg-background px-300"
            value={input.retentionDays} placeholder="Customer-approved duration"
            aria-invalid={Boolean(issues.retentionDays)}
            aria-describedby={issues.retentionDays ? `${id}-retention-error` : `${id}-retention-help`}
            onChange={(event) => update('retentionDays', event.currentTarget.value)} />
          <p id={`${id}-retention-help`} className="mt-200 text-200 text-muted-foreground">
            How long saved metadata and findings may be kept. No retention period is assumed.
          </p>
          {issues.retentionDays && <p id={`${id}-retention-error`} role="alert" className="mt-200 text-200 text-destructive">{issues.retentionDays}</p>}
        </div>
        <div>
          <label htmlFor={`${id}-expressions`} className="mb-200 block font-semibold">Expression storage</label>
          <select id={`${id}-expressions`}
            className="h-control w-full rounded-lg border border-input bg-background px-300"
            value={input.expressionStorage}
            aria-invalid={Boolean(issues.expressionStorage)}
            aria-describedby={issues.expressionStorage ? `${id}-expression-error` : `${id}-expression-help`}
            onChange={(event) => update('expressionStorage', event.currentTarget.value)}>
            <option value="">Choose explicitly</option>
            <option value="none">Do not store DAX formulas</option>
            <option value="authorized-only">Allow already-authorized DAX formulas</option>
          </select>
          <p id={`${id}-expression-help`} className="mt-200 text-200 leading-300 text-muted-foreground">
            DAX formulas can reveal sensitive business logic. You can choose not
            to store them. Storage consent never grants additional source access.
          </p>
          {issues.expressionStorage && <p id={`${id}-expression-error`} role="alert" className="mt-200 text-200 text-destructive">{issues.expressionStorage}</p>}
        </div>
        <button type="submit" className="inline-flex min-h-control items-center justify-center gap-200 rounded-lg bg-primary px-400 py-200 font-semibold text-primary-foreground hover:opacity-90">
          <Download aria-hidden="true" className="icon-size-200" /> Download configuration draft
        </button>
        {requested && <p role="status" className="text-200 text-primary">Configuration download requested. The draft has not been applied.</p>}
        {downloadError && <p role="alert" className="text-200 text-destructive">{downloadError}</p>}
      </form>
      {draft !== null && (
        <div className="mt-500 border-t border-border pt-500">
          <label htmlFor={`${id}-draft`} className="mb-200 block font-semibold">Configuration draft JSON</label>
          <textarea id={`${id}-draft`} readOnly rows={6} value={draft}
            aria-describedby={`${id}-draft-help`}
            className="w-full rounded-lg border border-input bg-background p-300 font-monospace text-200 leading-300" />
          <p id={`${id}-draft-help`} className="mt-200 text-200 leading-300 text-muted-foreground">
            If your host blocks downloads, copy this JSON into{' '}
            <code className="font-monospace">semantic-scanner.settings.json</code>.
            No settings have been applied.
          </p>
        </div>
      )}
    </section>
  );
}
