import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from '@webext-core/fake-browser';
import { http, HttpResponse } from 'msw';
import { expect, it, vi } from 'vitest';
import { Options } from '@/features/settings/options';
import { Popup } from '@/features/downloads/popup';
import { defaultDaemonOrigin } from '@/shared/api/endpoint';
import { capturePermissions } from '@/shared/browser/download-observation';
import { saveSettings } from '@/shared/browser/messages';
import { readSettings } from '@/shared/storage/settings';
import {
  aria2Offline,
  daemonOffline,
  daemonSettings,
  health,
} from './fixtures/daemon';
import { connectTestBackground, renderPage } from './render-page';
import { server } from './setup';

it('keeps capture defaults and merges concurrent settings changes', async () => {
  connectTestBackground();
  await fakeBrowser.storage.local.set({ appearance: 'invalid' });

  await expect(readSettings()).resolves.toEqual({
    version: 1,
    connection: { origin: defaultDaemonOrigin },
    appearance: 'system',
    capture: {
      enabled: false,
      askBeforeDownloading: true,
      defaultQueueId: 1,
      fineTuneOverride: null,
      startImmediately: true,
      useBrowserSession: false,
    },
  });

  await Promise.all([
    saveSettings({ connection: { origin: 'http://LOCALHOST:9999/' } }),
    saveSettings({ appearance: 'dark' }),
  ]);
  await expect(readSettings()).resolves.toMatchObject({
    version: 1,
    connection: { origin: 'http://localhost:9999' },
    appearance: 'dark',
  });
});

it('tests a draft address and updates another open view only after saving', async () => {
  connectTestBackground();
  const nextOrigin = 'http://127.0.0.1:47813';
  server.use(
    http.get(`${nextOrigin}/health`, () =>
      HttpResponse.json({ ...health, aria2_reachable: false }),
    ),
    http.get(`${nextOrigin}/settings`, () => HttpResponse.json(daemonSettings)),
    http.get(
      `${nextOrigin}/browser-capabilities`,
      () => new HttpResponse(null, { status: 404 }),
    ),
  );

  const user = userEvent.setup();
  const popup = renderPage(<Popup />);
  const page = renderPage(<Options />);
  const options = within(page.container);

  await within(popup.container).findByText('Daemon connected');
  await options.findByText('/home/user/Downloads/Videos');
  expect(await options.findByText('Asia/Tbilisi')).toBeVisible();
  const address = options.getByRole('textbox', { name: 'Server address' });
  expect(address).toHaveValue(defaultDaemonOrigin);
  await user.clear(address);
  await user.type(address, 'http://example.test');
  await user.click(options.getByRole('button', { name: 'Test connection' }));
  expect(await options.findByRole('alert')).toHaveTextContent(
    'Enter an HTTP address',
  );

  await user.clear(address);
  await user.type(address, nextOrigin);
  await user.click(options.getByRole('button', { name: 'Test connection' }));
  await options.findByText('Daemon connected · aria2 unreachable');
  expect(within(popup.container).getByText('Daemon connected')).toBeVisible();
  await expect(readSettings()).resolves.toMatchObject({
    connection: { origin: defaultDaemonOrigin },
  });

  await user.click(options.getByRole('button', { name: 'Save address' }));
  await within(popup.container).findByText(
    'Daemon connected · aria2 unreachable',
  );
  await options.findByText('/home/user/Downloads/Videos');
  expect(options.queryByText('Asia/Tbilisi')).not.toBeInTheDocument();
  await expect(readSettings()).resolves.toMatchObject({
    connection: { origin: nextOrigin },
  });
});

it('reconnects after daemon and aria2 outages', async () => {
  connectTestBackground();
  server.use(daemonOffline);
  const user = userEvent.setup();
  renderPage(<Options />);

  await screen.findByText('Daemon unavailable');
  server.use(aria2Offline);
  await user.click(screen.getByRole('button', { name: 'Reconnect' }));
  await screen.findByText('Daemon connected · aria2 unreachable');

  server.resetHandlers();
  await user.click(screen.getByRole('button', { name: 'Reconnect' }));
  await screen.findByText('Connected · aria2 is ready');
  await screen.findByText('/home/user/Downloads/Videos');
  expect(screen.getByText('Status unavailable')).toBeVisible();
});

it('requests capture access from Settings and saves preferences for future downloads', async () => {
  connectTestBackground();
  const request = vi
    .spyOn(fakeBrowser.permissions, 'request')
    .mockImplementation(async () => false);
  const user = userEvent.setup();
  renderPage(<Options />);

  const enable = await screen.findByRole('switch', {
    name: 'Capture browser downloads',
  });
  await waitFor(() => expect(enable).toBeEnabled());
  await user.click(enable);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Permission was declined',
  );
  expect(request).toHaveBeenCalledExactlyOnceWith(capturePermissions);
  expect(enable).not.toBeChecked();

  const queue = screen.getByRole('combobox', { name: 'Default queue' });
  await user.selectOptions(queue, '2');
  await waitFor(() => expect(queue).toHaveValue('2'));
  const startMode = screen.getByRole('combobox', {
    name: 'Default start mode',
  });
  await user.selectOptions(startMode, 'later');
  await waitFor(() => expect(startMode).toHaveValue('later'));

  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Default download settings' }),
    'custom',
  );
  await user.type(
    screen.getByRole('textbox', { name: 'Maximum retries' }),
    '0',
  );
  await user.click(screen.getByRole('button', { name: 'Save overrides' }));
  await waitFor(async () =>
    expect((await readSettings()).capture).toMatchObject({
      enabled: false,
      defaultQueueId: 2,
      startImmediately: false,
      fineTuneOverride: { max_retries: 0 },
    }),
  );

  const session = screen.getByRole('switch', { name: 'Use browser session' });
  await user.click(session);
  await waitFor(() => expect(session).toBeChecked());
  await expect(readSettings()).resolves.toMatchObject({
    capture: { useBrowserSession: true },
  });
});
