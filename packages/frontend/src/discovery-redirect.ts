import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';

broadcastResponseToMainFrame().catch(() => {
  const status = document.getElementById('redirect-status');
  if (status) {
    status.setAttribute('role', 'alert');
    status.textContent = 'Microsoft sign-in could not return to the scanner. Close this window and reconnect from the app.';
  }
});
