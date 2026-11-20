import { describe, expect, it } from 'vitest';

import { createDocumentSecurityPolicy } from './document-security-policy';

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split('; ').map((directive) => {
      const [name, ...sources] = directive.split(' ');
      return [name, sources];
    }),
  );
}

describe('production document security policy', () => {
  it('limits connections to required origins and blocks injected scripts and base URLs', () => {
    const policy = createDocumentSecurityPolicy('https://backend.example.test/v1/app/?query=ignored#ignored');
    const sources = directives(policy);

    expect(sources.get('connect-src')).toEqual([
      "'self'",
      'https://api.fabric.microsoft.com',
      'https://api.powerbi.com',
      'https://login.microsoftonline.com',
      'https://backend.example.test',
    ]);
    expect(policy).not.toContain('/v1/app');
    expect(policy).not.toContain('ignored');
    expect(sources.get('script-src')).toEqual(["'self'"]);
    expect(sources.get('base-uri')).toEqual(["'none'"]);
    expect(sources.get('default-src')).toEqual(["'none'"]);
    expect(sources.get('object-src')).toEqual(["'none'"]);
    expect(sources.get('frame-src')).toContain('https://login.microsoftonline.com');
    expect(sources.has('frame-ancestors')).toBe(false);
  });

  it.each([
    'http://backend.example.test',
    'https://user@backend.example.test',
    '//backend.example.test',
    'javascript:alert(1)',
  ])('rejects unsafe API configuration: %s', (apiUrl) => {
    expect(() => createDocumentSecurityPolicy(apiUrl)).toThrow(
      'VITE_RAYFIN_API_URL must be an absolute HTTPS URL without credentials.',
    );
  });

  it('keeps the first-run setup build restricted without inventing a backend', () => {
    expect(directives(createDocumentSecurityPolicy()).get('connect-src')).toEqual([
      "'self'",
      'https://api.fabric.microsoft.com',
      'https://api.powerbi.com',
      'https://login.microsoftonline.com',
    ]);
  });
});
