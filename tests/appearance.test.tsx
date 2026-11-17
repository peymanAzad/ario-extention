import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from '@webext-core/fake-browser';
import { expect, it } from 'vitest';
import { Options } from '@/features/settings/options';
import { saveSettings } from '@/shared/browser/messages';
import { readSettings } from '@/shared/storage/settings';
import { connectTestBackground, renderPage } from './render-page';

it('restores the Phase 1 appearance and saves theme changes in versioned settings', async () => {
  connectTestBackground();
  await fakeBrowser.storage.local.set({ appearance: 'dark' });
  const user = userEvent.setup();
  const page = renderPage(<Options />);

  await waitFor(() =>
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked(),
  );
  await user.click(screen.getByText('Light', { exact: true }));
  await waitFor(() =>
    expect(document.documentElement).toHaveAttribute(
      'data-appearance',
      'light',
    ),
  );
  await expect(readSettings()).resolves.toMatchObject({
    version: 1,
    appearance: 'light',
  });
  page.unmount();

  renderPage(<Options />);
  await waitFor(() =>
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked(),
  );

  await saveSettings({ appearance: 'system' });
  await waitFor(() =>
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked(),
  );
});
