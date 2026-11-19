import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from '@webext-core/fake-browser';
import { delay, http, HttpResponse } from 'msw';
import { beforeEach, expect, it, vi } from 'vitest';
import { Popup } from '@/features/downloads/popup';
import { DownloadList } from '@/features/downloads/download-list';
import { defaultDaemonOrigin } from '@/shared/api/endpoint';
import {
  readDashboardFilters,
  writeDashboardFilters,
} from '@/shared/storage/dashboard';
import { defaultDashboardFilters } from '@/shared/types/dashboard';
import {
  dashboardDownloads,
  liveDownload,
  mainQueue,
} from './fixtures/dashboard';
import { health, healthUrl } from './fixtures/daemon';
import { connectTestBackground, renderPage } from './render-page';
import { server } from './setup';

beforeEach(connectTestBackground);
const downloadsUrl = `${defaultDaemonOrigin}/downloads`;
const queuesUrl = `${defaultDaemonOrigin}/queues`;

it('renders all wire statuses, accessible progress, metadata, and queue state', async () => {
  renderPage(<Popup />);
  await screen.findByText('Movie.mp4');
  for (const label of [
    'Downloading',
    'Paused',
    'Completed',
    'Waiting',
    'Failed',
    'Removed',
  ]) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  }
  expect(screen.getByText('Downloading · acquiring metadata')).toBeVisible();
  expect(
    screen.getByRole('progressbar', { name: 'Movie.mp4 progress' }),
  ).toHaveAttribute('aria-valuenow', '50');
  expect(
    screen.getByRole('progressbar', {
      name: 'magnet:?xt=urn:btih:test progress',
    }),
  ).not.toHaveAttribute('aria-valuenow');
  expect(screen.getByText('Error: Tracker refused connection')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Main Queue · Active' }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Night shift · Paused' }),
  ).toBeVisible();
});

it('combines controls and remembers filters, search, sort and direction across openings', async () => {
  const user = userEvent.setup();
  const page = renderPage(<Popup />);
  await screen.findByText('Movie.mp4');
  await user.click(
    screen.getByRole('button', { name: 'Night shift · Paused' }),
  );
  await user.click(screen.getByRole('button', { name: 'Programs' }));
  await user.selectOptions(
    screen.getByLabelText('Filter download status'),
    'Error',
  );
  await user.type(screen.getByRole('searchbox'), 'EXAMPLE.TEST/FILE-5');
  await user.selectOptions(screen.getByLabelText('Sort downloads'), 'Name');
  await user.click(screen.getByRole('button', { name: 'Sort ascending' }));
  expect(screen.getByText('Installer.bin')).toBeVisible();
  expect(screen.queryByText('Backup.zip')).toBeNull();
  await waitFor(async () =>
    expect(await readDashboardFilters()).toMatchObject({
      queueId: 2,
      category: 'Program',
      status: 'Error',
      search: 'EXAMPLE.TEST/FILE-5',
      sortBy: 'Name',
      descending: false,
    }),
  );
  page.unmount();
  renderPage(<Popup />);
  await screen.findByText('Installer.bin');
  expect(screen.getByRole('searchbox')).toHaveValue('EXAMPLE.TEST/FILE-5');
  expect(screen.getByLabelText('Sort downloads')).toHaveValue('Name');
  expect(screen.getByRole('button', { name: 'Sort descending' })).toBeVisible();
});

it('resets a missing remembered queue after queues load, but preserves it during an outage', async () => {
  await writeDashboardFilters({ ...defaultDashboardFilters, queueId: 999 });
  server.use(http.get(queuesUrl, () => HttpResponse.error()));
  const page = renderPage(<Popup />);
  await screen.findByText('Live updates interrupted · showing last known data');
  expect((await readDashboardFilters()).queueId).toBe(999);
  page.unmount();
  server.resetHandlers();
  renderPage(<Popup />);
  await screen.findByText('Movie.mp4');
  await waitFor(async () =>
    expect((await readDashboardFilters()).queueId).toBeNull(),
  );
  expect(screen.getByRole('button', { name: 'All queues' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

it('retains successful data during outage and reconnects every resource', async () => {
  const user = userEvent.setup();
  renderPage(<Popup />);
  await screen.findByText('Movie.mp4');
  server.use(
    ...[healthUrl, downloadsUrl, queuesUrl].map((url) =>
      http.get(url, () => HttpResponse.error()),
    ),
  );
  await screen.findByText(
    'Live updates interrupted · showing last known data',
    {},
    { timeout: 2500 },
  );
  expect(screen.getByText('Movie.mp4')).toBeVisible();
  server.resetHandlers();
  await user.click(screen.getByRole('button', { name: 'Reconnect' }));
  await waitFor(() =>
    expect(screen.queryByText(/Live updates interrupted/)).toBeNull(),
  );
  expect(screen.getByText('Daemon connected')).toBeVisible();
});

it('shows loading, initial failure, empty and no-match states', async () => {
  server.use(
    http.get(downloadsUrl, async () => {
      await delay(100);
      return HttpResponse.error();
    }),
  );
  const page = renderPage(<Popup />);
  expect(screen.getByText('Loading downloads…')).toBeVisible();
  await screen.findByText('Could not load downloads. Reconnect to try again.');
  server.use(http.get(downloadsUrl, () => HttpResponse.json([])));
  await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
  await screen.findByText('No downloads yet.');
  page.unmount();
  server.resetHandlers();
  renderPage(<Popup />);
  await screen.findByText('Movie.mp4');
  await userEvent.type(screen.getByRole('searchbox'), 'missing-file');
  expect(screen.getByText('No downloads match your filters.')).toBeVisible();
});

it('polls all resources once a second only while visible and stops on unmount', async () => {
  const calls = { health: 0, downloads: 0, queues: 0 };
  server.use(
    http.get(healthUrl, () => {
      calls.health++;
      return HttpResponse.json(health);
    }),
    http.get(downloadsUrl, () => {
      calls.downloads++;
      return HttpResponse.json(dashboardDownloads);
    }),
    http.get(queuesUrl, () => {
      calls.queues++;
      return HttpResponse.json([mainQueue]);
    }),
  );
  const page = renderPage(<Popup />);
  await screen.findByText('Movie.mp4');
  await waitFor(
    () => expect(calls).toEqual({ health: 2, downloads: 2, queues: 2 }),
    { timeout: 2500 },
  );
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  const hiddenCalls = { ...calls };
  await act(() => new Promise((resolve) => setTimeout(resolve, 1150)));
  expect(calls).toEqual(hiddenCalls);
  visibility.mockReturnValue('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await waitFor(() =>
    expect(calls.downloads).toBeGreaterThan(hiddenCalls.downloads),
  );
  page.unmount();
  const closedCalls = { ...calls };
  await new Promise((resolve) => setTimeout(resolve, 1150));
  expect(calls).toEqual(closedCalls);
});

it('virtualizes ten thousand rows and supports keyboard navigation to the last row', async () => {
  const items = Array.from({ length: 10000 }, (_, i) => liveDownload(i + 1));
  renderPage(
    <DownloadList
      items={items}
      queues={[mainQueue]}
      controls={{
        unavailable: false,
        pending: () => false,
        onAction: vi.fn(),
        onDetails: vi.fn(),
      }}
    />,
  );
  expect(screen.getAllByRole('listitem').length).toBeLessThan(20);
  const region = screen.getByRole('region', { name: 'Download list' });
  region.focus();
  expect(region).toHaveFocus();
  Object.defineProperty(region, 'scrollHeight', { value: 1120000 });
  fireEvent.keyDown(region, { key: 'End' });
  expect(screen.getByText('file-10000.bin')).toBeInTheDocument();
  expect(screen.getAllByRole('listitem').at(-1)).toHaveAttribute(
    'aria-posinset',
    '10000',
  );
  fireEvent.keyDown(region, { key: 'Home' });
  expect(screen.getByText('file-1.bin')).toBeInTheDocument();
});

it('falls back from corrupt saved filters and reports failed persistence', async () => {
  await fakeBrowser.storage.local.set({
    dashboardFilters: { status: 'nonsense' },
  });
  expect(await readDashboardFilters()).toEqual(defaultDashboardFilters);
  vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValue(
    new Error('storage full'),
  );
  renderPage(<Popup />);
  await screen.findByText('Movie.mp4');
  await userEvent.type(screen.getByRole('searchbox'), 'movie');
  await screen.findByText(
    'Could not remember dashboard filters. Your current view is still available.',
  );
});

it('does not show another daemon’s cached downloads when the saved address changes', async () => {
  renderPage(<Popup />);
  await screen.findByText('Movie.mp4');
  server.use(
    ...['health', 'downloads', 'queues'].map((path) =>
      http.get(`http://localhost:47813/${path}`, () => HttpResponse.error()),
    ),
  );
  const { updateSettings } = await import('@/shared/storage/settings');
  await act(() =>
    updateSettings({ connection: { origin: 'http://localhost:47813' } }),
  );
  await screen.findByText('Could not load downloads. Reconnect to try again.');
  expect(screen.queryByText('Movie.mp4')).toBeNull();
});

it('finishes queued filter saves in the background after the popup unmounts', async () => {
  const { saveDashboardFilters } = await import('@/shared/browser/messages');
  const page = renderPage(<Popup />);
  await screen.findByText('Movie.mp4');
  const saves = ['m', 'mo', 'movie'].map((search) =>
    saveDashboardFilters({ ...defaultDashboardFilters, search }),
  );
  page.unmount();
  await Promise.all(saves);
  expect((await readDashboardFilters()).search).toBe('movie');
});

it('makes navigation, filters, sorting and list scrolling reachable with Tab', async () => {
  const user = userEvent.setup();
  renderPage(<Popup />);
  await screen.findByText('Movie.mp4');
  const controls = [
    screen.getByRole('button', { name: 'Open settings' }),
    screen.getByRole('button', { name: 'All downloads' }),
    ...['Video', 'Music', 'Documents', 'Archives', 'Programs', 'Other'].map(
      (name) => screen.getByRole('button', { name }),
    ),
    screen.getByRole('button', { name: 'Create queue' }),
    screen.getByRole('button', { name: 'All queues' }),
    screen.getByRole('button', { name: 'Main Queue · Active' }),
    screen.getByRole('button', { name: 'Night shift · Paused' }),
    screen.getByRole('button', { name: 'Manage queues' }),
    screen.getByRole('button', { name: 'Add download' }),
    screen.getByRole('searchbox'),
    screen.getByLabelText('Filter download status'),
    screen.getByRole('button', { name: 'Clear completed' }),
    screen.getByLabelText('Sort downloads'),
    screen.getByRole('button', { name: 'Sort ascending' }),
    screen.getByRole('region', { name: 'Download list' }),
  ];
  for (const control of controls) {
    await user.tab();
    expect(control).toHaveFocus();
  }
});
