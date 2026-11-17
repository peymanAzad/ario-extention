import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from '@webext-core/fake-browser';
import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';
import { Options } from '@/features/settings/options';
import { Popup } from '@/features/downloads/popup';
import { defaultDaemonOrigin } from '@/shared/api/endpoint';
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
  );

  const user = userEvent.setup();
  const popup = renderPage(<Popup />);
  const page = renderPage(<Options />);
  const options = within(page.container);

  await within(popup.container).findByText('Daemon connected');
  await options.findByText('/home/user/Downloads/Videos');
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
