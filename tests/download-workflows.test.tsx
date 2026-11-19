import { fakeBrowser } from '@webext-core/fake-browser';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, it, vi } from 'vitest';
import { Popup } from '@/features/downloads/popup';
import { extractDownloadLinks } from '@/features/downloads/workflow-model';
import { defaultDaemonOrigin } from '@/shared/api/endpoint';
import { torrentLimit } from '@/shared/types/download-workflows';
import { dashboardDownloads, liveDownload } from './fixtures/dashboard';
import { connectTestBackground, renderPage } from './render-page';
import { server } from './setup';

const downloadsUrl = `${defaultDaemonOrigin}/downloads`;
const magnet =
  'magnet:?xt=urn:btih:45d97a82ef9d74a734a37b804a4e0566592dd9cc&dn=Sample';
const download = 'https://example.test/folder/file.zip?auth=private';
const retry = 'https://example.test/retry.zip';
const skipped = 'http://example.test/skipped.zip';

const button = (name: string) => screen.getByRole('button', { name });

function rejection(message: string, status = 400) {
  return HttpResponse.json({ result: 'error', message }, { status });
}

beforeEach(connectTestBackground);

it('extracts unique links and magnets from mixed prose while preserving encoded URLs', () => {
  const signed = 'https://example.test/file_(1).zip?key=x%2By%26z';
  expect(
    extractDownloadLinks(`• <${signed}>
    example (${magnet}), [download](${download}).
    FTP: ftp://example.test/file. Again: "${signed}"`),
  ).toEqual([signed, magnet, download]);
  expect(extractDownloadLinks('https://example.test/latest.')).toEqual([
    'https://example.test/latest.',
  ]);
  expect(extractDownloadLinks('junk https:// magnet:?dn=missing')).toEqual([]);
});

it('keeps per-link outcomes after a partial failure and requires selecting failed links for retry', async () => {
  const user = userEvent.setup();
  const calls: unknown[] = [];
  let reject = true;
  server.use(
    http.post(downloadsUrl, async ({ request }) => {
      expect(request.headers.get('content-type')).toMatch(/application\/json/);
      const body = (await request.json()) as { inputs: { Url: string }[] };
      calls.push(body);
      const url = body.inputs[0]?.Url;
      if (url === retry && reject) return rejection('The queue changed');
      return HttpResponse.json([
        liveDownload(20 + calls.length, { url, status: 'Pending' }),
      ]);
    }),
  );
  const page = renderPage(<Popup />);
  await screen.findByText('Movie.mp4');
  await user.click(button('Add download'));
  await waitFor(() =>
    expect(screen.getByLabelText('Download links')).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText('Download links'), {
    target: { value: `File (${download}), ${magnet}\n${retry}\n${skipped}` },
  });
  await user.click(screen.getByRole('checkbox', { name: skipped }));
  await user.selectOptions(screen.getByLabelText('Queue'), '2');
  await user.selectOptions(
    screen.getByLabelText('Download settings'),
    'override',
  );
  await user.type(screen.getByLabelText('Maximum retries'), '0');
  await user.type(screen.getByLabelText('Retry delay (seconds)'), '0');
  await user.click(button('Save for later'));
  expect(await screen.findByText('Failed · The queue changed')).toBeVisible();
  expect(screen.getAllByText('Added', { exact: true })).toHaveLength(2);
  expect(button('Save for later')).toBeDisabled();
  expect(calls).toEqual(
    [download, magnet, retry].map((url) => ({
      inputs: [{ Url: url }],
      queue_id: 2,
      start_immediately: false,
      finetune_override: {
        connections_per_download: null,
        max_connections_per_server: null,
        alloc_strategy: null,
        stream_piece_selector: null,
        max_retries: 0,
        retry_wait_seconds: 0,
      },
    })),
  );

  reject = false;
  await user.click(screen.getByRole('checkbox', { name: retry }));
  await user.click(button('Start now'));
  await waitFor(() =>
    expect(screen.getAllByText('Added', { exact: true })).toHaveLength(3),
  );
  expect(calls).toHaveLength(4);
  expect(calls[3]).toMatchObject({
    inputs: [{ Url: retry }],
    start_immediately: true,
  });

  page.unmount();
  const persisted = await fakeBrowser.storage.local.get(null);
  expect(JSON.stringify(persisted)).not.toContain(download);
  expect(JSON.stringify(persisted)).not.toContain(magnet);
  renderPage(<Popup />);
  await screen.findByText('Movie.mp4');
  await user.click(button('Add download'));
  await waitFor(() =>
    expect(screen.getByLabelText('Maximum retries')).toHaveValue('0'),
  );
  expect(screen.getByLabelText('Queue')).toHaveValue('2');
  expect(screen.getByLabelText('Retry delay (seconds)')).toHaveValue('0');
  expect(screen.getByLabelText('Download links')).toHaveValue('');
});

it('locks ambiguous import outcomes and validates multipart torrent uploads', async () => {
  const user = userEvent.setup();
  const sent: unknown[] = [];
  server.use(
    http.post(downloadsUrl, () =>
      rejection('Transfer request interrupted', 500),
    ),
  );
  const fetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (resource, options) => {
      if (resource !== `${downloadsUrl}/torrent`)
        return fetch(resource, options);
      const body = options?.body as FormData;
      const blob = body.get('file') as File;
      sent.push({
        metadata: JSON.parse(String(body.get('metadata'))),
        name: blob.name,
        size: blob.size,
        suffix: await blob.slice(-13).text(),
      });
      expect(options?.method).toBe('POST');
      expect(options?.headers).toBeUndefined();
      return Response.json(
        liveDownload(9, { source_type: 'Torrent', status: 'Pending' }),
      );
    },
  );
  renderPage(<Popup />);
  await screen.findByText('Movie.mp4');
  await user.click(button('Add download'));
  await waitFor(() =>
    expect(screen.getByLabelText('Download links')).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText('Download links'), {
    target: { value: download },
  });
  await user.click(button('Start now'));
  expect(
    await screen.findByText(/Check the dashboard before trying again/),
  ).toBeVisible();
  expect(screen.getByRole('checkbox', { name: download })).toBeDisabled();
  expect(button('Start now')).toBeDisabled();

  await user.click(button('Torrent file'));
  const fileInput = screen.getByLabelText('Torrent file');
  fireEvent.change(fileInput, {
    target: { files: [new File([], 'empty.torrent')] },
  });
  expect(screen.getByRole('alert')).toHaveTextContent(
    'The torrent file is empty',
  );
  const oversized = new File(['x'], 'big.torrent');
  Object.defineProperty(oversized, 'size', { value: torrentLimit + 1 });
  fireEvent.change(fileInput, { target: { files: [oversized] } });
  expect(screen.getByRole('alert')).toHaveTextContent('16 MiB');
  expect(button('Save for later')).toBeDisabled();
  fireEvent.change(fileInput, {
    target: {
      files: [
        new File(
          [new Uint8Array(torrentLimit - 13), 'torrent-bytes'],
          'sample.torrent',
        ),
      ],
    },
  });
  await user.click(button('Save for later'));
  expect(await screen.findByText('Torrent added.')).toBeVisible();
  expect(sent).toEqual([
    {
      metadata: {
        queue_id: 1,
        start_immediately: false,
        finetune_override: null,
      },
      name: 'sample.torrent',
      size: torrentLimit,
      suffix: 'torrent-bytes',
    },
  ]);
});

function setupMutableDownloads() {
  const items = new Map(
    dashboardDownloads.map((item) => [item.download.id, item]),
  );
  const calls: string[] = [];
  server.use(
    http.get(downloadsUrl, () => HttpResponse.json([...items.values()])),
    http.get(`${downloadsUrl}/:id`, ({ params }) => {
      const item = items.get(Number(params.id));
      return item
        ? HttpResponse.json(item)
        : rejection('download missing', 404);
    }),
    http.post(`${downloadsUrl}/:id/:action`, ({ params }) => {
      const id = Number(params.id);
      const item = items.get(id);
      calls.push(`${id}:${params.action}`);
      if (!item) return rejection('download missing', 404);
      if (params.action === 'pause') return HttpResponse.json(item);
      const active = {
        ...item,
        download: { ...item.download, status: 'Active' },
      } as const;
      items.set(id, active);
      return HttpResponse.json(active);
    }),
    http.put(`${downloadsUrl}/:id/:action`, async ({ params, request }) => {
      const id = Number(params.id);
      const item = items.get(id);
      const change = (await request.json()) as object;
      calls.push(`${id}:${params.action}`);
      if (!item) return rejection('download missing', 404);
      const updated = {
        ...item,
        download: {
          ...item.download,
          ...(params.action === 'queue' ? change : { finetune: change }),
        },
      };
      items.set(id, updated as typeof item);
      return HttpResponse.json(updated);
    }),
    http.delete(`${downloadsUrl}/completed`, ({ request }) => {
      const scope = new URL(request.url).searchParams.get('queue_id');
      calls.push(`clear:${scope ?? 'all'}`);
      for (const [id, { download }] of items) {
        if (
          download.status === 'Completed' &&
          (!scope || Number(scope) === download.queue_id)
        )
          items.delete(id);
      }
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete(`${downloadsUrl}/:id`, ({ params, request }) => {
      const id = Number(params.id);
      items.delete(id);
      const files = new URL(request.url).searchParams.get('delete_files');
      calls.push(`remove:${id}:${files === 'true' ? 'files' : 'record'}`);
      return files === 'true'
        ? HttpResponse.json({
            removed_payloads: 1,
            missing_payloads: 2,
            metadata_complete: false,
          })
        : new HttpResponse(null, { status: 204 });
    }),
  );
  return { items, calls };
}

it('uses live action semantics including a pending pause and protects against concurrent changes', async () => {
  const user = userEvent.setup();
  const { items, calls } = setupMutableDownloads();
  renderPage(<Popup />);
  await screen.findByText('Movie.mp4');
  const pause = button('Pause Movie.mp4');
  await user.click(pause);
  expect(await screen.findByText('Pausing…')).toBeVisible();
  await waitFor(() => expect(calls).toEqual(['1:pause']));
  expect(pause).toBeDisabled();
  items.set(1, liveDownload(1, { filename: 'Movie.mp4', status: 'Paused' }));
  const resume = await screen.findByRole(
    'button',
    { name: 'Resume Movie.mp4' },
    { timeout: 3500 },
  );
  // Simulate the TUI completing the row after the last dashboard snapshot.
  items.set(1, liveDownload(1, { filename: 'Movie.mp4', status: 'Completed' }));
  await user.click(resume);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The download status changed',
  );
  expect(calls).toEqual(['1:pause']);
  await user.click(button('Download details for Movie.mp4'));
  await user.click(await screen.findByRole('button', { name: 'Restart' }));
  await waitFor(() => expect(calls).toContain('1:resume'));
  await user.keyboard('{Escape}');
  for (const [label, id] of [
    ['Resume Song.flac', 2],
    ['Start Backup.zip', 4],
    ['Retry Installer.bin', 5],
    ['Retry Removed.bin', 6],
  ] as const) {
    await user.click(button(label));
    await waitFor(() => expect(calls).toContain(`${id}:resume`));
  }
});

it('moves and edits downloads, copies details, and distinguishes both deletion modes and clear scopes', async () => {
  const user = userEvent.setup();
  const copy = vi.spyOn(navigator.clipboard, 'writeText');
  const { items, calls } = setupMutableDownloads();
  items.set(8, liveDownload(8, { status: 'Completed', queue_id: 2 }));
  renderPage(<Popup />);
  await screen.findByText('Movie.mp4');

  async function details(name: string) {
    await user.click(button(`Download details for ${name}`));
    await screen.findByRole('button', { name: 'Copy path' });
  }

  await details('Movie.mp4');
  await user.click(button('Copy URL'));
  await user.click(button('Copy path'));
  expect(copy.mock.calls).toEqual([
    ['https://example.test/file-1.bin'],
    ['/tmp'],
  ]);
  await user.click(button('Move to queue'));
  await user.selectOptions(screen.getByLabelText('Destination queue'), '2');
  await user.click(button('Move download'));
  await screen.findByText('Download moved.');
  expect(items.get(1)?.download.queue_id).toBe(2);

  await user.click(button('Settings'));
  await user.type(screen.getByLabelText('Maximum retries'), '0');
  await user.selectOptions(screen.getByLabelText('File allocation'), 'None');
  await user.click(button('Save settings'));
  await screen.findByText('Download settings saved.');
  expect(items.get(1)?.download.finetune).toMatchObject({
    max_retries: 0,
    alloc_strategy: 'None',
    connections_per_download: null,
  });

  await user.click(button('Remove record'));
  expect(calls).not.toContain('remove:1:record');
  await user.click(button('Remove record'));
  expect(
    await screen.findByText('Download record removed. Files kept.'),
  ).toBeVisible();

  await details('Song.flac');
  await user.click(button('Delete files…'));
  expect(calls).not.toContain('remove:2:files');
  await user.click(button('Delete record and files'));
  expect(
    await screen.findByText(
      'Record deleted. 1 file deleted. 2 files missing. The daemon had incomplete file metadata.',
    ),
  ).toBeVisible();

  await user.click(button('Night shift · Paused'));
  await user.click(button('Clear completed'));
  const dialog = screen.getByRole('dialog', {
    name: 'Clear completed downloads?',
  });
  expect(
    within(dialog).getByText(/completed records in Night shift/),
  ).toBeVisible();
  await user.click(
    within(dialog).getByRole('button', { name: 'Clear completed' }),
  );
  await waitFor(() => expect(items.has(8)).toBe(false));
  expect(items.has(3)).toBe(true);
  await user.click(await screen.findByRole('button', { name: 'All queues' }));
  await user.click(button('Clear completed'));
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Clear completed',
    }),
  );
  await waitFor(() => expect(items.has(3)).toBe(false));
  expect(calls).toEqual([
    '1:queue',
    '1:finetune',
    'remove:1:record',
    'remove:2:files',
    'clear:2',
    'clear:all',
  ]);
}, 10_000);

it('rejects a settings write if the queue changed after the editor opened', async () => {
  const user = userEvent.setup();
  const { items, calls } = setupMutableDownloads();
  renderPage(<Popup />);
  await screen.findByText('Movie.mp4');
  await user.click(button('Download details for Movie.mp4'));
  await user.click(await screen.findByRole('button', { name: 'Settings' }));
  await user.type(screen.getByLabelText('Maximum retries'), '0');

  items.set(
    1,
    liveDownload(1, {
      filename: 'Movie.mp4',
      queue_id: 2,
    }),
  );
  await user.click(button('Save settings'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    /another queue|changed this download/,
  );
  expect(calls).toEqual([]);
  await user.click(await screen.findByRole('button', { name: 'Reload form' }));
  expect(screen.getByLabelText('Maximum retries')).toHaveValue('');
});

it('issues one add request when a user repeats the submit gesture while it is pending', async () => {
  const user = userEvent.setup();
  const { promise, resolve } = Promise.withResolvers<void>();
  const send = vi.fn(async () => {
    await promise;
    return HttpResponse.json([liveDownload(14, { status: 'Pending' })]);
  });
  server.use(http.post(downloadsUrl, send));
  renderPage(<Popup />);
  await screen.findByText('Movie.mp4');
  await user.click(button('Add download'));
  await waitFor(() =>
    expect(screen.getByLabelText('Download links')).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText('Download links'), {
    target: { value: download },
  });
  const start = button('Start now');
  fireEvent.click(start);
  fireEvent.click(start);
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(button('Adding…')).toBeDisabled();
  await user.keyboard('{Escape}');
  expect(screen.getByRole('dialog')).toBeVisible();
  resolve();
  expect(await screen.findByText('1 download added.')).toBeVisible();
  expect(send).toHaveBeenCalledTimes(1);
});
