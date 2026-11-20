export function createDocumentSecurityPolicy(apiUrl?: string): string {
  const connections = new Set([
    "'self'",
    'https://api.fabric.microsoft.com',
    'https://api.powerbi.com',
    'https://login.microsoftonline.com',
  ]);

  if (apiUrl) {
    const endpoint = URL.parse(apiUrl);
    if (!endpoint || endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
      throw new Error('VITE_RAYFIN_API_URL must be an absolute HTTPS URL without credentials.');
    }
    connections.add(endpoint.origin);
  }

  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${[...connections].join(' ')}`,
    "frame-src 'self' https://login.microsoftonline.com",
    "worker-src 'self' blob:",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}
