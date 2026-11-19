import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, it } from 'vitest';
import { Popup } from '@/features/downloads/popup';
import { defaultDaemonOrigin } from '@/shared/api/endpoint';
import { writeQueue } from '@/shared/browser/messages';
import type { Queue } from '@/shared/types/daemon';
import type { QueueSettingsInput } from '@/shared/types/queue-workflows';
import {
  dashboardDownloads,
  liveDownload,
  mainQueue,
  nightQueue,
} from './fixtures/dashboard';
import { connectTestBackground, renderPage } from './render-page';
import { server } from './setup';

const queuesUrl = `${defaultDaemonOrigin}/queues`;
const downloadsUrl = `${defaultDaemonOrigin}/downloads`;

function conflict(message: string) {
  return HttpResponse.json({ result: 'error', message }, { status: 409 });
}

function applySettings(
  queue: Queue,
  body: QueueSettingsInput & { position: number },
): Queue {
  return {
    ...queue,
    name: body.name,
    position: body.position,
    settings: {
      max_concurrent_downloads: body.max_concurrent_downloads,
      max_retries: body.max_retries,
      retry_wait_seconds: body.retry_wait_seconds,
      on_success_command: body.on_success_command || null,
      on_stop_command: body.on_stop_command || null,
      default_finetune: body.default_finetune,
    },
    scheduler: {
      enabled: body.scheduler_enabled,
      recurrence: body.recurrence,
      run_missed_on_startup: body.run_missed_on_startup,
    },
  };
}

function fixture(secondary: Queue = nightQueue) {
  const queues = new Map([
    [mainQueue.id, mainQueue],
    [secondary.id, secondary],
  ]);
  let downloads = [...dashboardDownloads];
  const settingsWrites: (QueueSettingsInput & { position: number })[] = [];
  const orderWrites: number[][] = [];
  const deleteRequests: (string | null)[] = [];
  const actions: string[] = [];
  let rejectOrder = false;
  const state = {
    queues,
    settingsWrites,
    orderWrites,
    deleteRequests,
    actions,
    rejectReorder: () => {
      rejectOrder = true;
    },
    addDownload: () => {
      downloads.push(liveDownload(8, { queue_id: 2 }));
    },
  };

  server.use(
    http.get(queuesUrl, () => HttpResponse.json([...queues.values()])),
    http.get(`${queuesUrl}/:id`, ({ params }) => {
      const queue = queues.get(Number(params.id));
      return queue
        ? HttpResponse.json(queue)
        : new HttpResponse(null, { status: 404 });
    }),
    http.get(downloadsUrl, ({ request }) => {
      const queueId = new URL(request.url).searchParams.get('queue_id');
      return HttpResponse.json(
        queueId === null
          ? downloads
          : downloads.filter(
              ({ download }) => download.queue_id === Number(queueId),
            ),
      );
    }),
    http.post(queuesUrl, async ({ request }) => {
      const body = (await request.json()) as QueueSettingsInput & {
        position: number;
      };
      settingsWrites.push(body);
      const queue = applySettings({ ...nightQueue, id: 3 }, body);
      queues.set(queue.id, queue);
      return HttpResponse.json(queue);
    }),
    http.put(`${queuesUrl}/:id`, async ({ params, request }) => {
      const body = (await request.json()) as QueueSettingsInput & {
        position: number;
      };
      settingsWrites.push(body);
      const queue = queues.get(Number(params.id));
      if (!queue) return new HttpResponse(null, { status: 404 });
      const updated = applySettings(queue, body);
      queues.set(updated.id, updated);
      return HttpResponse.json(updated);
    }),
    http.put(`${queuesUrl}/2/reorder`, async ({ request }) => {
      const { ordered_ids: ids } = (await request.json()) as {
        ordered_ids: number[];
      };
      orderWrites.push(ids);
      if (rejectOrder) {
        rejectOrder = false;
        return HttpResponse.json(
          { result: 'error', message: 'Reorder unavailable' },
          { status: 503 },
        );
      }
      downloads = downloads.map((item) => {
        const position = ids.indexOf(item.download.id);
        return position === -1
          ? item
          : {
              ...item,
              download: { ...item.download, position_in_queue: position },
            };
      });
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${queuesUrl}/:id/:action`, ({ params }) => {
      const id = Number(params.id);
      const queue = queues.get(id);
      const action = String(params.action);
      actions.push(action);
      if (!queue) return new HttpResponse(null, { status: 404 });
      if (
        action === 'resume' &&
        !downloads.some(
          ({ download }) =>
            download.queue_id === id &&
            ['Pending', 'Paused'].some((status) => status === download.status),
        )
      ) {
        return conflict('Queue has no pending or paused downloads');
      }
      queues.set(id, {
        ...queue,
        status: action === 'pause' ? 'Paused' : 'Active',
      });
      return new HttpResponse(null, { status: 200 });
    }),
    http.delete(`${queuesUrl}/:id`, ({ request, params }) => {
      const id = Number(params.id);
      const removeRecords = new URL(request.url).searchParams.get(
        'delete_downloads',
      );
      deleteRequests.push(removeRecords);
      if (
        removeRecords !== 'true' &&
        downloads.some(({ download }) => download.queue_id === id)
      )
        return conflict(
          'queue contains download items; confirmation is required',
        );
      if (removeRecords === 'true')
        downloads = downloads.filter(
          ({ download }) => download.queue_id !== id,
        );
      queues.delete(id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return state;
}

type User = ReturnType<typeof userEvent.setup>;
const button = (name: string) => screen.getByRole('button', { name });
const tab = (name: string) => screen.getByRole('tab', { name });
const field = (name: string) => screen.getByLabelText(name, { exact: true });
function fill(name: string, value: string) {
  fireEvent.change(field(name), { target: { value } });
}
async function openManager(user: User) {
  await waitFor(() => expect(button('Manage queues')).toBeEnabled());
  await user.click(button('Manage queues'));
}
async function editNightQueue(user: User) {
  await openManager(user);
  await waitFor(() => expect(button('Edit Night shift')).toBeEnabled());
  await user.click(button('Edit Night shift'));
  await screen.findByRole('heading', { name: 'Night shift' });
}

beforeEach(connectTestBackground);

it('validates and round trips creation defaults, daily and weekly overnight windows, and queue fine-tuning', async () => {
  const state = fixture();
  const user = userEvent.setup();
  renderPage(<Popup />);
  await waitFor(() => expect(button('Create queue')).toBeEnabled());
  await user.click(button('Create queue'));
  expect(field('Concurrent downloads')).toHaveValue('1');
  expect(field('Maximum retries')).toHaveValue('3');
  expect(field('Retry delay (seconds)')).toHaveValue('5');
  expect(field('File allocation')).toHaveDisplayValue('Inherit aria2 default');

  await user.click(button('Create queue'));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a queue name.');
  fill('Queue name', 'Late shift');
  fill('Concurrent downloads', '0');
  await user.click(button('Create queue'));
  expect(screen.getByRole('alert')).toHaveTextContent('positive whole number');
  fill('Concurrent downloads', '1');
  await user.click(tab('Schedule'));
  const enabled = screen.getByRole('switch', { name: 'Enable queue schedule' });
  expect(enabled).not.toBeChecked();
  await user.click(enabled);
  await user.click(button('Create queue'));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Select at least one day.',
  );
  await user.click(button('Monday'));
  fill('Start time', '22:00');
  fill('Stop time', '22:00');
  await user.click(button('Create queue'));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Choose different start and stop times.',
  );
  expect(state.settingsWrites).toEqual([]);
  await user.selectOptions(field('Repeat'), 'daily');
  fill('Stop time', '02:00');
  expect(screen.getByText(/stops the following day/)).toBeVisible();
  expect(
    await screen.findByText(/daemon timezone \(Asia\/Tbilisi\)/),
  ).toBeVisible();
  await user.click(screen.getByRole('switch', { name: 'Catch up on startup' }));
  await user.click(button('Create queue'));
  expect(await screen.findByText('Queue “Late shift” created.')).toBeVisible();
  expect(state.settingsWrites[0]).toEqual({
    name: 'Late shift',
    position: 0,
    max_concurrent_downloads: 1,
    max_retries: 3,
    retry_wait_seconds: 5,
    default_finetune: mainQueue.settings.default_finetune,
    scheduler_enabled: true,
    recurrence: {
      Weekly: {
        days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        start_time: '22:00:00',
        end_time: '02:00:00',
      },
    },
    run_missed_on_startup: true,
    on_success_command: '',
    on_stop_command: '',
  });

  await openManager(user);
  await user.click(
    await screen.findByRole('button', { name: 'Edit Late shift' }),
  );
  await screen.findByRole('heading', { name: 'Late shift' });
  fill('Connections per download', '8');
  fill('Connections per server', '4');
  fill('Maximum retries', '0');
  fill('Retry delay (seconds)', '0');
  await user.selectOptions(field('File allocation'), 'Prealloc');
  await user.selectOptions(field('Piece selection'), 'InOrder');
  await user.click(tab('Schedule'));
  expect(field('Repeat')).toHaveValue('daily');
  expect(field('Start time')).toHaveValue('22:00:00');
  expect(
    screen.getByRole('switch', { name: 'Catch up on startup' }),
  ).toBeChecked();
  await user.selectOptions(field('Repeat'), 'weekly');
  await user.click(button('Tuesday'));
  await user.click(button('Save changes'));
  expect(await screen.findByText('Queue changes saved.')).toBeVisible();
  expect(state.settingsWrites[1]).toMatchObject({
    max_retries: 0,
    retry_wait_seconds: 0,
    default_finetune: {
      connections_per_download: 8,
      max_connections_per_server: 4,
      alloc_strategy: 'Prealloc',
      stream_piece_selector: 'InOrder',
    },
    recurrence: {
      Weekly: {
        days: ['Mon', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        start_time: '22:00:00',
        end_time: '02:00:00',
      },
    },
  });
});

it('loads scheduled stop and command history, converts one-time inputs to UTC, and clears commands explicitly', async () => {
  const ended = '2026-11-20T03:00:00Z';
  const commandResult = {
    id: 1,
    run_id: 1,
    status: 'failed',
    queued_at: '2026-11-20T02:56:00Z',
    started_at: '2026-11-20T02:56:01Z',
    finished_at: ended,
    exit_code: 17,
    message: 'Command exited with code 17',
  } as const;
  const state = fixture({
    ...nightQueue,
    settings: {
      ...nightQueue.settings,
      on_success_command: 'true',
      on_stop_command: 'false',
    },
    scheduled_stop_at: ended,
    event_results: {
      on_success: commandResult,
      on_stop: {
        ...commandResult,
        id: 2,
        status: 'interrupted',
        exit_code: null,
        message: 'Daemon stopped',
      },
    },
  });
  const user = userEvent.setup();
  renderPage(<Popup />);
  await editNightQueue(user);
  await user.click(tab('Events'));
  expect(screen.getByText('Failed', { exact: true })).toBeVisible();
  expect(screen.getByText('Interrupted')).toBeVisible();
  expect(screen.getByText('Exit code 17')).toBeVisible();
  expect(screen.getByText('Daemon stopped')).toBeVisible();
  expect(
    within(
      screen.getByRole('region', { name: 'Latest command results' }),
    ).getAllByText(new Date(ended).toLocaleString()),
  ).toHaveLength(2);
  fill('When all downloads succeed', '');
  fill('When the queue stops automatically', ' ');
  await user.click(tab('Schedule'));
  expect(screen.getByText('Current run stops', { exact: false })).toBeVisible();
  await user.click(
    screen.getByRole('switch', { name: 'Enable queue schedule' }),
  );
  fill('Start date and time', '2030-02-14T22:45');
  fill('Stop date and time', '2030-02-14T22:44');
  await user.click(button('Save changes'));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'must be after the start',
  );
  fill('Stop date and time', '2030-02-15T03:30');
  await user.click(button('Save changes'));
  expect(await screen.findByText('Queue changes saved.')).toBeVisible();
  expect(state.settingsWrites[0]).toMatchObject({
    position: 1,
    on_success_command: '',
    on_stop_command: '',
    recurrence: {
      Once: {
        start: new Date('2030-02-14T22:45').toISOString(),
        end: new Date('2030-02-15T03:30').toISOString(),
      },
    },
  });
  await editNightQueue(user);
  await user.click(tab('Events'));
  expect(field('When all downloads succeed')).toHaveValue('');
  expect(field('When the queue stops automatically')).toHaveValue('');
  await user.click(tab('Schedule'));
  expect(field('Start date and time')).toHaveValue('2030-02-14T22:45');
  expect(field('Stop date and time')).toHaveValue('2030-02-15T03:30');
});

it('stages reordering, discards changes on Cancel, and retries a partial save without another settings write', async () => {
  const state = fixture();
  const user = userEvent.setup();
  renderPage(<Popup />);
  await editNightQueue(user);
  await user.click(tab('Download Items'));
  await user.click(button('Move Installer.bin up'));
  const list = () =>
    screen.getAllByRole('listitem').map((item) => item.textContent);
  expect(list()[0]).toContain('Installer.bin');
  expect(state.orderWrites).toEqual([]);
  await user.click(button('Cancel'));
  await user.click(button('Edit Night shift'));
  await screen.findByRole('heading', { name: 'Night shift' });
  fill('Queue name', 'Nightly');
  await user.click(tab('Download Items'));
  expect(list()[0]).toContain('Backup.zip');
  await user.click(button('Move Backup.zip down'));
  state.rejectReorder();
  await user.click(button('Save changes'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Queue settings saved. Download order could not be saved. Reorder unavailable',
  );
  expect(state.settingsWrites).toHaveLength(1);
  expect(state.queues.get(2)?.name).toBe('Nightly');
  expect(list()[0]).toContain('Installer.bin');
  await waitFor(() => expect(button('Save changes')).toBeEnabled());
  await user.click(button('Save changes'));
  expect(await screen.findByText('Queue changes saved.')).toBeVisible();
  expect(state.settingsWrites).toHaveLength(1);
  expect(state.orderWrites).toEqual([
    [5, 4],
    [5, 4],
  ]);
  await openManager(user);
  await user.click(button('Edit Nightly'));
  await screen.findByRole('heading', { name: 'Nightly' });
  await user.click(tab('Download Items'));
  expect(list()[0]).toContain('Installer.bin');
});

it('refuses to overwrite a changed queue order and allows resetting it to the fresh snapshot', async () => {
  const state = fixture();
  const user = userEvent.setup();
  renderPage(<Popup />);
  await editNightQueue(user);
  await user.click(tab('Download Items'));
  await user.click(button('Move Installer.bin up'));
  state.addDownload();
  await user.click(button('Save changes'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Queue items or their order changed',
  );
  expect(state.settingsWrites).toEqual([]);
  expect(state.orderWrites).toEqual([]);
  await waitFor(() => expect(button('Reset order')).toBeEnabled());
  await user.click(button('Reset order'));
  await user.click(
    await screen.findByRole('button', { name: 'Move file-8.bin up' }),
  );
  await user.click(button('Save changes'));
  expect(await screen.findByText('Queue changes saved.')).toBeVisible();
  expect(state.orderWrites).toEqual([[4, 8, 5]]);
});

it('checks the current settings before overwriting another client’s edit', async () => {
  const state = fixture();
  const user = userEvent.setup();
  renderPage(<Popup />);
  await editNightQueue(user);
  fill('Queue name', 'My update');
  state.queues.set(2, { ...nightQueue, name: 'Other client’s update' });
  await user.click(button('Save changes'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Queue settings changed.',
  );
  expect(state.settingsWrites).toEqual([]);
});

it('requires checking the queue list after an unconfirmed create result', async () => {
  const state = fixture();
  let requests = 0;
  server.use(
    http.post(queuesUrl, async ({ request }) => {
      requests += 1;
      const body = (await request.json()) as QueueSettingsInput & {
        position: number;
      };
      expect(body.scheduler_enabled).toBe(false);
      expect(body.recurrence).toEqual({
        Weekly: { days: [], start_time: '02:00:00', end_time: '06:00:00' },
      });
      state.queues.set(3, applySettings({ ...nightQueue, id: 3 }, body));
      return HttpResponse.error();
    }),
  );
  const user = userEvent.setup();
  renderPage(<Popup />);
  await waitFor(() => expect(button('Create queue')).toBeEnabled());
  await user.click(button('Create queue'));
  fill('Queue name', 'Already created');
  await user.click(button('Create queue'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not confirm whether the queue was created.',
  );
  await waitFor(() => expect(button('Cancel')).toBeEnabled());
  expect(button('Create queue')).toBeDisabled();
  await user.click(button('Cancel'));
  await openManager(user);
  expect(await screen.findByText('Already created')).toBeVisible();
  expect(requests).toBe(1);
});

it('starts and pauses real queues, handles empty resume, and requires confirmation to delete nonempty queues', async () => {
  const state = fixture();
  state.queues.set(3, { ...nightQueue, id: 3, name: 'Empty queue' });
  const user = userEvent.setup();
  renderPage(<Popup />);
  await openManager(user);
  expect(
    screen.queryByRole('button', { name: 'Delete Main Queue' }),
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit All queues' })).toBeNull();
  await expect(
    writeQueue('daemon.queue.delete', {
      origin: defaultDaemonOrigin,
      id: 1,
      confirmed: true,
    }),
  ).rejects.toThrow('Main Queue cannot be deleted');
  await user.click(button('Start Empty queue'));
  expect(await screen.findByText(/^Nothing to start/)).toBeVisible();
  await waitFor(() => expect(button('Start Night shift')).toBeEnabled());
  await user.click(button('Start Night shift'));
  await waitFor(() => expect(button('Pause Night shift')).toBeEnabled());
  await user.click(button('Pause Night shift'));
  await waitFor(() => expect(button('Start Night shift')).toBeEnabled());
  expect(state.actions).toEqual(['resume', 'resume', 'pause']);

  await user.click(button('Delete Empty queue'));
  expect(await screen.findByText('Queue “Empty queue” deleted.')).toBeVisible();
  await waitFor(() => expect(button('Delete Night shift')).toBeEnabled());
  await user.click(button('Delete Night shift'));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Downloaded files will be kept.');
  await waitFor(() =>
    expect(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    ).toBeEnabled(),
  );
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(state.queues.has(2)).toBe(true);
  await user.click(button('Delete Night shift'));
  const confirm = await screen.findByRole('button', {
    name: 'Delete queue',
  });
  await waitFor(() => expect(confirm).toBeEnabled());
  await user.click(confirm);
  expect(await screen.findByText('Queue “Night shift” deleted.')).toBeVisible();
  expect(state.deleteRequests).toEqual([null, null, null, 'true']);
  expect(state.queues.has(2)).toBe(false);
});
