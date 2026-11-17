import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { Popup } from '@/features/downloads/popup';
import { openOptions } from '@/shared/browser/runtime';

vi.mock('@/shared/browser/runtime', () => ({ openOptions: vi.fn() }));

it('renders the downloads shell and opens browser settings', async () => {
  const user = userEvent.setup();
  render(<Popup />);

  expect(screen.getByRole('heading', { name: 'Downloads' })).toBeVisible();
  expect(
    screen.getByRole('complementary', { name: 'Library' }),
  ).toHaveTextContent('All downloads');
  expect(screen.queryByRole('list')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Open settings' }));

  expect(openOptions).toHaveBeenCalledOnce();
});

it('reports a failed settings launch', async () => {
  vi.mocked(openOptions).mockRejectedValueOnce(new Error('Unavailable'));
  const user = userEvent.setup();
  render(<Popup />);

  await user.click(screen.getByRole('button', { name: 'Open settings' }));

  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Settings could not open',
    ),
  );
});
