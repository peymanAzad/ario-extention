import assert from 'node:assert/strict';
import { waitFor } from './live-daemon.mjs';

export function setFormValue({ selector, value }) {
  const element = document.querySelector(selector);
  Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(element),
    'value',
  ).set.call(element, value);
  element.dispatchEvent(
    new globalThis.Event(element.tagName === 'SELECT' ? 'change' : 'input', {
      bubbles: true,
    }),
  );
}

export async function verifyLiveManagement(daemon, ui) {
  await ui.click('#manage-queues');
  await ui.button('Create queue');
  await ui.fill(
    '#queue-form label input[required]:not([inputmode])',
    'Release smoke',
  );
  await ui.click('[role="tab"][aria-controls$="-schedule"]');
  await ui.click('[aria-label="Enable queue schedule"]');
  await ui.fill('.queue-pane select', 'once');
  const start = new Date(Math.floor(Date.now() / 1000) * 1000 + 25_000);
  const end = new Date(start.getTime() + 120_000);
  const localInput = (time) =>
    new Date(time.getTime() - time.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 19);
  await ui.fill('.queue-pane input[type=datetime-local]', localInput(start));
  await ui.fill(
    '.queue-pane label:has(input[type=datetime-local]) + label input[type=datetime-local]',
    localInput(end),
  );
  await ui.button('Create queue');

  const queue = await waitFor(
    async () =>
      (await daemon.read('/queues')).find(
        ({ name }) => name === 'Release smoke',
      ),
    'the saved queue',
  );
  assert.equal(queue.scheduler.enabled, true);
  assert.equal(
    Date.parse(queue.scheduler.recurrence.Once.start),
    start.getTime(),
  );
  assert.equal(Date.parse(queue.scheduler.recurrence.Once.end), end.getTime());
  await ui.text('Queue “Release smoke” created.');

  const url = `${daemon.sourceOrigin}/capture-files/management`;
  await ui.click('#add-download');
  await ui.fill('textarea', url);
  await ui.fill('[role="dialog"] select', String(queue.id));
  await ui.button('Save for later');
  const record = await waitFor(
    async () =>
      (await daemon.read('/downloads')).find(
        ({ download }) => download.url === url,
      )?.download,
    'the submitted download',
  );
  assert.equal(record.queue_id, queue.id);
  assert.equal(record.status, 'Pending');
  const completed = await verifyTransfer(daemon, url, 40_000);
  assert.equal(completed.manually_started, false);
  return completed;
}

export async function verifyTransfer(daemon, url, timeout = 20_000) {
  const downloads = await waitFor(
    async () => {
      const matches = (await daemon.read('/downloads'))
        .map(({ download }) => download)
        .filter((download) => download.url === url);
      return matches.some(({ status }) => status === 'Completed') && matches;
    },
    `the daemon to complete ${url}`,
    timeout,
  );
  assert.equal(downloads.length, 1);
  return downloads[0];
}
