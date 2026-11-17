import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from '@webext-core/fake-browser';
import { describe, expect, it } from 'vitest';
import { Options } from '@/features/appearance/options';
import { ThemeProvider } from '@/features/appearance/theme-provider';
import {
  readAppearance,
  watchAppearance,
  writeAppearance,
} from '@/shared/storage/appearance';

describe('appearance storage', () => {
  it('falls back to System for absent or invalid data', async () => {
    await expect(readAppearance()).resolves.toBe('system');

    await fakeBrowser.storage.local.set({ appearance: 'obsolete-value' });

    await expect(readAppearance()).resolves.toBe('system');
  });

  it('observes writes and resets from another extension page', async () => {
    const values: string[] = [];
    const stop = watchAppearance((value) => values.push(value));
    try {
      await writeAppearance('dark');
      await fakeBrowser.storage.local.remove('appearance');

      expect(values).toEqual(['dark', 'system']);
    } finally {
      stop();
    }
  });
});

it('saves the selected theme and restores it on remount', async () => {
  const user = userEvent.setup();
  const settings = render(
    <ThemeProvider>
      <Options />
    </ThemeProvider>,
  );

  await waitFor(() =>
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeEnabled(),
  );
  expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
  await user.click(screen.getByText('Dark'));
  await waitFor(() =>
    expect(document.documentElement).toHaveAttribute('data-appearance', 'dark'),
  );
  await expect(readAppearance()).resolves.toBe('dark');
  settings.unmount();

  render(
    <ThemeProvider>
      <Options />
    </ThemeProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked(),
  );

  await writeAppearance('light');
  await waitFor(() =>
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked(),
  );
});
