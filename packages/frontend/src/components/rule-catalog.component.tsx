import { useId, useState } from 'react';
import { ArrowRight, BookOpen, Search } from 'lucide-react';
import { DRAFT_POLICY_VERSION, RULE_CATALOG } from '@rayfin-app/shared';

export function RuleCatalog() {
  const id = useId();
  const [query, setQuery] = useState('');
  const [classification, setClassification] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const rules = RULE_CATALOG.filter((rule) =>
    (classification === 'all' || rule.classification === classification) &&
    `${rule.id} ${rule.name} ${rule.group}`.toLocaleLowerCase().includes(normalizedQuery)
  );

  return (
    <section aria-labelledby={`${id}-title`} className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border p-600">
        <div className="mb-300 flex flex-wrap items-center justify-between gap-300">
          <h2 id={`${id}-title`} className="font-heading text-500 leading-500">Rule policy explorer</h2>
          <span className="rounded-full bg-secondary px-300 py-100 font-monospace text-200">{DRAFT_POLICY_VERSION}</span>
        </div>
        <p className="text-muted-foreground">
          These are rule definitions, not scan results. No policy is published and
          no checks are running. Customer administrators must approve applicability and severity.
        </p>
        <div className="mt-500 flex flex-col gap-300 sm:flex-row">
          <div className="relative flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute top-300 left-300 icon-size-200 text-muted-foreground" />
            <label htmlFor={`${id}-search`} className="sr-only">Search draft rules</label>
            <input id={`${id}-search`} type="search" value={query} placeholder="Search a rule, topic, or ID"
              onChange={(event) => setQuery(event.currentTarget.value)}
              className="h-control w-full rounded-lg border border-input bg-background pr-300 pl-800" />
          </div>
          <label htmlFor={`${id}-classification`} className="sr-only">Rule classification</label>
          <select id={`${id}-classification`} value={classification}
            onChange={(event) => setClassification(event.currentTarget.value)}
            className="h-control rounded-lg border border-input bg-background px-300">
            <option value="all">All classifications</option>
            <option value="deterministic">Deterministic</option>
            <option value="heuristic">Heuristic</option>
            <option value="manual">Manual</option>
          </select>
        </div>
        <p aria-live="polite" className="mt-300 text-200 text-muted-foreground">{rules.length} of {RULE_CATALOG.length} draft rules</p>
      </div>
      <div className="divide-y divide-border">
        {rules.map((rule) => {
          const expanded = rule.id === selectedId;
          return (
            <article key={rule.id}>
              <button type="button" aria-expanded={expanded} aria-controls={`${id}-${rule.id}`}
                onClick={() => setSelectedId(expanded ? null : rule.id)}
                className="flex w-full items-center gap-400 p-500 text-left hover:bg-accent">
                <BookOpen aria-hidden="true" className="icon-size-300 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{rule.name}</span>
                  <span className="text-200 text-muted-foreground">{rule.id} / {rule.group}</span>
                </span>
                <span className="hidden rounded-full bg-muted px-300 py-100 text-200 capitalize text-muted-foreground sm:inline">{rule.classification}</span>
                <ArrowRight aria-hidden="true" className={`icon-size-200 shrink-0 ${expanded ? 'rotate-90' : ''}`} />
              </button>
              {expanded && (
                <dl id={`${id}-${rule.id}`} className="grid gap-400 bg-muted p-600 md:grid-cols-2">
                  {[
                    ['Evidence', rule.evidence],
                    ['Why it matters', rule.impact],
                    ['Interpretation boundary', rule.boundary],
                    ['Next action', rule.remediation],
                  ].map(([label, text]) => (
                    <div key={label}>
                      <dt className="mb-100 text-200 font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
                      <dd>{text}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </article>
          );
        })}
      </div>
      {rules.length === 0 && (
        <div className="p-800 text-center">
          <p className="font-semibold">No draft rules match these filters.</p>
          <button type="button" className="mt-300 font-semibold text-primary underline underline-offset-4"
            onClick={() => { setQuery(''); setClassification('all'); }}>
            Reset rule filters
          </button>
        </div>
      )}
    </section>
  );
}
