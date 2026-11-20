import type { OpaqueSession } from '@microsoft/rayfin-auth';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Root } from './Root';
import type { AuthConfig, IAuthService } from './services/rayfin-auth.service';

vi.mock('@/lib/fabric-discovery', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/fabric-discovery')>(),
  createDiscoveryClient: () => ({
    initialize: async () => {},
    connect: async () => 'scanner@example.invalid',
    discover: async () => [],
    scan: async () => { throw new Error('Unexpected metadata scan during authentication.'); },
    disconnect: async () => {},
  }),
}));

const authenticated: OpaqueSession = {
  user: null,
  isAuthenticated: true,
  isAnonymous: false,
};

function service(config: AuthConfig = { kind: 'ready' }): IAuthService {
  return {
    config,
    canSignIn: config.kind === 'ready',
    resolveSession: vi.fn(async () => null),
    signIn: vi.fn(async () => authenticated),
  };
}

describe('protected app content with standalone sign-in', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not render the scan while session resolution is pending', () => {
    const auth = service();
    auth.resolveSession = vi.fn(
      () => new Promise<OpaqueSession | null>(() => {})
    );
    render(<Root rayfinAuthService={auth} />);
    expect(
      screen.queryByRole('heading', { name: 'Scan semantic models' })
    ).toBeNull();
    expect(screen.getByText('Connecting to Fabric…')).toBeVisible();
  });

  it('offers sign-in outside the portal without rendering protected content', async () => {
    render(<Root rayfinAuthService={service()} />);
    expect(
      await screen.findByRole('button', { name: 'Sign in with Microsoft' })
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Scan semantic models' })
    ).toBeNull();
    expect(screen.queryByText(/outside Fabric/)).toBeNull();
  });

  it('renders the scan only after a silent authenticated session resolves', async () => {
    const auth = service();
    auth.resolveSession = vi.fn(async () => authenticated);
    render(<Root rayfinAuthService={auth} />);
    expect(
      await screen.findByRole('heading', {
        name: 'Scan semantic models',
      })
    ).toBeVisible();
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('does not treat an anonymous SDK session as an authenticated app user', async () => {
    const auth = service();
    auth.resolveSession = vi.fn(async () => ({
      ...authenticated,
      isAnonymous: true,
    }));
    render(<Root rayfinAuthService={auth} />);
    expect(
      await screen.findByRole('button', { name: 'Sign in with Microsoft' })
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Scan semantic models' })
    ).toBeNull();
  });

  it('recovers from failed local automatic sign-in through a user gesture', async () => {
    const auth = service();
    auth.resolveSession = vi.fn(async () => {
      throw new Error('Local sign-in unavailable.');
    });
    render(<Root rayfinAuthService={auth} />);
    const button = await screen.findByRole('button', {
      name: 'Try Sign in with Microsoft',
    });
    expect(
      screen.queryByRole('heading', { name: 'Scan semantic models' })
    ).toBeNull();
    await act(async () => fireEvent.click(button));
    expect(auth.signIn).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole('heading', {
        name: 'Scan semantic models',
      })
    ).toBeVisible();
  });

  it('keeps content protected after interactive sign-in fails', async () => {
    const auth = service();
    auth.signIn = vi.fn(async () => {
      throw new Error('Sign-in was cancelled.');
    });
    render(<Root rayfinAuthService={auth} />);
    const button = await screen.findByRole('button', {
      name: 'Sign in with Microsoft',
    });
    await act(async () => fireEvent.click(button));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign-in was cancelled.'
    );
    expect(
      screen.queryByRole('heading', { name: 'Scan semantic models' })
    ).toBeNull();
  });

  it('removes protected content when the authenticated session ends', async () => {
    const auth = service();
    auth.resolveSession = vi.fn(async () => authenticated);
    let notify: ((session: OpaqueSession | null) => void) | undefined;
    const unsubscribe = vi.fn();
    auth.onSessionChange = vi.fn((listener) => {
      notify = listener;
      return unsubscribe;
    });
    render(<Root rayfinAuthService={auth} />);
    expect(
      await screen.findByRole('heading', {
        name: 'Scan semantic models',
      })
    ).toBeVisible();
    await act(async () => notify?.(null));
    expect(
      await screen.findByRole('button', { name: 'Sign in with Microsoft' })
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Scan semantic models' })
    ).toBeNull();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it.each<{ config: AuthConfig; title: string; diagnostic: string }>([
    {
      config: { kind: 'not-deployed' },
      title: 'Fabric is not connected',
      diagnostic: 'No Fabric deployment is connected.',
    },
    {
      config: { kind: 'incomplete', missing: ['publishableKey'] },
      title: 'Fabric connection needs setup',
      diagnostic: 'Missing configuration: publishableKey.',
    },
    {
      config: { kind: 'config-error', message: 'Runtime configuration is unavailable.' },
      title: 'Fabric connection is unavailable',
      diagnostic: 'Runtime configuration is unavailable.',
    },
  ])('fails closed with an actionable $config.kind state', async ({ config, title, diagnostic }) => {
    await act(async () => render(<Root rayfinAuthService={service(config)} />));
    expect(
      screen.queryByRole('heading', { name: 'Scan semantic models' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Sign in with Microsoft' })
    ).toBeNull();
    expect(screen.getByRole('heading', { name: 'Get started' })).toBeVisible();
    expect(screen.getByRole('heading', { name: title })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reload connection' })).toBeEnabled();
    expect(screen.queryByRole('form', { name: 'Customer data-handling settings' })).toBeNull();
    const diagnostics = screen.getByText((text, element) =>
      element?.tagName === 'P' && text.includes(diagnostic)
    );
    expect(diagnostics).not.toBeVisible();
    fireEvent.click(screen.getByText('Setup details', { exact: true }));
    expect(diagnostics).toBeVisible();
    if (config.kind === 'config-error') {
      expect(screen.getByRole('alert')).toHaveTextContent(title);
    }
  });

  it('keeps setup limited to connection diagnostics without retention or expression approvals', async () => {
    const auth = service({ kind: 'not-deployed' });
    await act(async () => render(<Root rayfinAuthService={auth} />));
    expect(screen.queryByLabelText('Retention in days')).toBeNull();
    expect(screen.queryByLabelText('Expression storage')).toBeNull();

    fireEvent.click(screen.getByText('Setup details', { exact: true }));
    expect(screen.getByRole('heading', { name: 'Connection diagnostics' })).toBeVisible();
    expect(screen.getByText(/no history, exports, or stored model evidence/)).toBeVisible();
    expect(screen.queryByLabelText('Retention in days')).toBeNull();
    expect(screen.queryByLabelText('Expression storage')).toBeNull();
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Scan semantic models' })).toBeNull();
  });
});
