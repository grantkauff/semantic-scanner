//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { Fragment, useState, type ReactNode } from 'react';

import { useAuth } from '@/hooks/auth.context';
import { SetupScreen } from './setup-screen.component';

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const {
    session,
    isLoading,
    isAuthenticated,
    canSignIn,
    signIn,
    isSigningIn,
    signInError,
    config,
    error,
  } = useAuth();

  const [boundary, setBoundary] = useState({ session, version: 0 });
  if (boundary.session !== session) {
    // Without a public user ID, a replacement session cannot reuse private results.
    setBoundary({ session, version: boundary.version + 1 });
  }
  const principalId = session?.user?.id;

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">
          Connecting to Fabric…
        </div>
      </div>
    );
  }

  if (config.kind !== 'ready') return <SetupScreen config={config} />;

  if (error && !canSignIn) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-lg">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
            Semantic scanner
          </p>
          <h2 className="mb-2 text-lg font-semibold text-card-foreground">
            Couldn't sign you in
          </h2>
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated && canSignIn) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-lg">
          <div
            aria-hidden="true"
            className="mx-auto mb-4 grid h-10 w-10 grid-cols-2 gap-0.5"
          >
            <span className="bg-primary" />
            <span className="bg-primary/80" />
            <span className="bg-primary/70" />
            <span className="bg-primary/90" />
          </div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
            Semantic scanner
          </p>
          <h2 className="mb-2 text-xl font-semibold text-card-foreground">
            {error ? "Couldn't sign you in automatically" : 'Welcome back'}
          </h2>
          {error ? (
            <p role="alert" className="mb-4 text-sm text-destructive">
              {error.message}
            </p>
          ) : (
            <p className="mb-6 text-sm text-muted-foreground">
              Sign in with your Microsoft account to open this Fabric app.
            </p>
          )}
          <button
            type="button"
            className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSigningIn}
            onClick={() => void signIn()}
          >
            {isSigningIn
              ? 'Signing in…'
              : error
                ? 'Try Sign in with Microsoft'
                : 'Sign in with Microsoft'}
          </button>
          {signInError ? (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {signInError.message}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center">
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            Sign-in is unavailable
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            This app requires an authenticated session. Check the authentication
            configuration, then reload to try again.
          </p>
        </div>
      </div>
    );
  }

  return <Fragment key={principalId ? `user:${principalId}` : `session:${boundary.version}`}>{children}</Fragment>;
}
