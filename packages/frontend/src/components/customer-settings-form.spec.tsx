import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCustomerSettings } from '@rayfin-app/shared';

import { CustomerSettingsForm } from './customer-settings-form.component';

describe('explicit customer data-handling settings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['', '0', '-1', '1.5', '30days', '9007199254740992'])(
    'rejects unsafe retention input %j',
    (retentionDays) => {
      const result = parseCustomerSettings({ retentionDays, expressionStorage: 'none' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.retentionDays).toBeDefined();
    }
  );

  it('requires an expression choice even when retention is valid', () => {
    const result = parseCustomerSettings({ retentionDays: '30', expressionStorage: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.expressionStorage).toBeDefined();
  });

  it.each(['none', 'authorized-only'])('preserves the explicit %s expression choice', (expressionStorage) => {
    expect(parseCustomerSettings({ retentionDays: ' 30 ', expressionStorage })).toEqual({
      ok: true,
      settings: { formatVersion: 1, retentionDays: 30, expressionStorage },
    });
  });

  it('displays both missing choices without attempting a download', () => {
    render(<CustomerSettingsForm />);
    fireEvent.submit(screen.getByRole('form', { name: 'Customer data-handling settings' }));
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('downloads only a settings draft and releases the temporary blob', () => {
    const createObjectURL = vi.fn(() => 'blob:settings-draft');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', class extends URL {
      static override createObjectURL = createObjectURL;
      static override revokeObjectURL = revokeObjectURL;
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<CustomerSettingsForm />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Retention in days' }), {
      target: { value: '30' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Expression storage' }), {
      target: { value: 'none' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Customer data-handling settings' }));
    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:settings-draft');
    expect(screen.getByRole('status')).toHaveTextContent('The draft has not been applied.');
    expect(screen.getByRole('textbox', { name: 'Configuration draft JSON' })).toHaveValue(
      `${JSON.stringify({ formatVersion: 1, retentionDays: 30, expressionStorage: 'none' }, null, 2)}\n`
    );
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('reports a rejected browser download without reporting success', () => {
    vi.stubGlobal('URL', class extends URL {
      static override createObjectURL(): string { throw new Error('Downloads unavailable.'); }
    });
    render(<CustomerSettingsForm />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Retention in days' }), { target: { value: '7' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Expression storage' }), { target: { value: 'none' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Customer data-handling settings' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Downloads unavailable.');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Configuration draft JSON' })).toHaveValue(
      `${JSON.stringify({ formatVersion: 1, retentionDays: 7, expressionStorage: 'none' }, null, 2)}\n`
    );
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Retention in days' }), { target: { value: '14' } });
    expect(screen.queryByRole('textbox', { name: 'Configuration draft JSON' })).toBeNull();
  });
});
