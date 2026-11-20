import { CircleDashed, Moon, ScanLine, Sun } from 'lucide-react';

import { useTheme } from '@/hooks/theme.context';
import type { AuthConfig } from '@/services/rayfin-auth.service';

type SetupConfig = Exclude<AuthConfig, { readonly kind: 'ready' }>;

function configurationMessage(config: SetupConfig) {
  switch (config.kind) {
    case 'not-deployed':
      return {
        title: 'Fabric is not connected',
        nextStep: 'Ask the app owner to run the setup wizard and deploy to their Fabric workspace, then reload to sign in.',
        diagnostic: 'No Fabric deployment is connected. Run npm run setup, npm run login, and npm run deploy from the repository root. Deployment requires an explicit workspace preview and confirmation.',
      };
    case 'incomplete':
      return {
        title: 'Fabric connection needs setup',
        nextStep: 'Ask your app administrator to finish configuring the Fabric connection, then reload to sign in.',
        diagnostic: `Missing configuration: ${config.missing.join(', ')}. Connect an approved deployment, then restart the frontend.`,
      };
    case 'config-error':
      return {
        title: 'Fabric connection is unavailable',
        nextStep: 'Reload to try again. If the problem continues, ask your app administrator to check the deployment.',
        diagnostic: `Runtime configuration could not be loaded. The app stopped rather than reuse a different deployment. ${config.message}`,
      };
  }
}

export function SetupScreen({ config }: { config: SetupConfig }) {
  const { isDark, toggleTheme } = useTheme();
  const message = configurationMessage(config);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-500 py-400 md:px-page">
        <div className="mx-auto flex max-w-content items-center justify-between gap-400">
          <div className="flex items-center gap-300">
            <span className="rounded-lg bg-primary p-200 text-primary-foreground"><ScanLine aria-hidden="true" className="icon-size-300" /></span>
            <span className="font-heading text-500">semantic scanner</span>
          </div>
          <button type="button" aria-label={isDark ? 'Use light theme' : 'Use dark theme'} onClick={toggleTheme}
            className="rounded-lg border border-border p-200 hover:bg-accent">
            {isDark ? <Sun aria-hidden="true" className="icon-size-300" /> : <Moon aria-hidden="true" className="icon-size-300" />}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-setup space-y-600 px-500 py-800 md:px-800 md:py-page">
        <div>
          <h1 className="font-heading text-600 leading-600">Get started</h1>
          <p className="mt-200 text-muted-foreground">
            Find missing descriptions and inspect AI-instruction presence across your accessible Fabric semantic models.
          </p>
        </div>
        <section role={config.kind === 'config-error' ? 'alert' : 'status'}
          className="rounded-2xl border border-border bg-card p-500 md:p-600">
          <div className="flex items-start gap-300">
            <CircleDashed aria-hidden="true" className="mt-100 icon-size-300 shrink-0 text-warning-foreground" />
            <div>
              <h2 className="font-heading text-500 leading-500">{message.title}</h2>
              <p className="mt-200 text-muted-foreground">{message.nextStep}</p>
            </div>
          </div>
          <button type="button" onClick={() => window.location.reload()}
            className="mt-500 inline-flex min-h-control items-center justify-center rounded-lg bg-primary px-400 py-200 font-semibold text-primary-foreground hover:opacity-90">
            Reload connection
          </button>
        </section>
        <details className="border-t border-border pt-400">
          <summary className="cursor-pointer rounded-lg py-200 font-semibold text-muted-foreground hover:text-foreground">
            Setup details
          </summary>
          <div className="mt-400 space-y-500">
            <section aria-labelledby="connection-diagnostics-title" className="rounded-xl bg-muted p-400">
              <h2 id="connection-diagnostics-title" className="mb-200 font-semibold">Connection diagnostics</h2>
              <p className="wrap-anywhere text-200 leading-300 text-muted-foreground">{message.diagnostic}</p>
            </section>
            <p className="text-muted-foreground">
              This scanner reads description metadata and bounded AI-instruction presence. It has no history, exports, or stored model evidence.
            </p>
          </div>
        </details>
      </main>
    </div>
  );
}
