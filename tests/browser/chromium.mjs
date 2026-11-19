import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { darkBackground, lightBackground, readBuild } from './build.mjs';
import { openSmokeConfirmation, smokeLink } from './confirmation.mjs';
import { startTestDaemon } from './daemon.mjs';

const { directory, manifest } = await readBuild('chrome');
assert.equal(manifest.background.service_worker, 'background.js');

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  executablePath: process.env.CHROME_PATH,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    '--enable-unsafe-extension-debugging',
    '--screen-info={0,0 1280x900}',
    '--window-size=1200,850',
  ],
  colorScheme: 'dark',
  viewport: null,
});

let daemon;
try {
  daemon = await startTestDaemon();
  const browser = context.browser();
  assert.ok(browser);
  const cdp = await browser.newBrowserCDPSession();
  const workerStarted = context.waitForEvent('serviceworker', {
    timeout: 10_000,
  });
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: directory });
  await cdp.detach();
  const worker = await workerStarted;
  const origin = `chrome-extension://${id}`;
  const popup = await context.newPage();
  popup.setDefaultTimeout(10_000);
  await popup.goto(`${origin}/popup.html`);
  await popup.getByRole('heading', { name: 'Downloads' }).waitFor();
  await worker.evaluate(() =>
    globalThis.chrome.contextMenus.update('ario-download-link', {}),
  );
  await worker.evaluate(() => globalThis.chrome.action.openPopup());
  await popup.waitForFunction(() =>
    globalThis.chrome.extension
      .getViews({ type: 'popup' })
      .some(
        (view) =>
          view.document.querySelector('h1')?.textContent === 'Downloads' &&
          view.document.body.clientWidth === 780 &&
          view.document.body.clientHeight === 580,
      ),
  );
  await popup.evaluate(() =>
    globalThis.chrome.extension.getViews({ type: 'popup' })[0].close(),
  );
  const background = () =>
    popup
      .locator('body')
      .evaluate((body) => getComputedStyle(body).backgroundColor);
  assert.equal(await background(), darkBackground);
  await popup.emulateMedia({ colorScheme: 'light' });
  assert.equal(await background(), lightBackground);

  const optionsOpened = context.waitForEvent('page', { timeout: 10_000 });
  await popup.getByRole('button', { name: 'Open settings' }).click();
  const options = await optionsOpened;
  options.setDefaultTimeout(10_000);
  await options.getByRole('heading', { name: 'Settings' }).waitFor();
  assert.equal(options.url(), `${origin}/options.html`);
  await options.waitForFunction(
    () => !document.querySelector('fieldset').disabled,
  );
  const address = options.getByRole('textbox', { name: 'Server address' });
  await address.fill('http://example.test');
  await options.getByRole('button', { name: 'Test connection' }).click();
  await options
    .getByRole('alert')
    .filter({ hasText: 'Enter an HTTP address' })
    .waitFor();
  await address.fill(daemon.origin);
  await options.getByRole('button', { name: 'Test connection' }).click();
  await options.getByText('Connection test', { exact: true }).waitFor();
  await options
    .getByText('Connected · aria2 is ready', { exact: true })
    .last()
    .waitFor();
  await options.getByRole('button', { name: 'Save address' }).click();
  await options.getByRole('heading', { name: 'Download locations' }).waitFor();
  if (daemon.fixture)
    await options.getByText('Asia/Tbilisi', { exact: true }).waitFor();
  await popup.bringToFront();
  await popup.getByText('Daemon connected', { exact: true }).waitFor();
  await options.bringToFront();
  await options.getByText('Dark', { exact: true }).click();
  await popup.waitForFunction(
    () => document.documentElement.dataset.appearance === 'dark',
  );
  assert.equal(await background(), darkBackground);

  await options.reload();
  await options.waitForFunction(
    () => document.querySelector('input[value=dark]').checked,
  );
  assert.equal(await address.inputValue(), daemon.origin);
  await options.getByText('Light', { exact: true }).click();
  await popup.waitForFunction(
    () => document.documentElement.dataset.appearance === 'light',
  );
  assert.equal(await background(), lightBackground);

  await popup.bringToFront();
  await popup.setViewportSize({ width: 780, height: 580 });
  if (daemon.fixture) {
    await popup
      .getByRole('article', { name: 'Movie.mp4', exact: true })
      .waitFor();
    assert.equal(
      await popup
        .getByRole('progressbar', { name: 'Movie.mp4 progress' })
        .getAttribute('aria-valuenow'),
      '50',
    );
    assert.equal(
      await popup
        .getByRole('progressbar', {
          name: 'magnet:?xt=urn:btih:fixture progress',
        })
        .getAttribute('aria-valuenow'),
      null,
    );
    await popup.getByRole('button', { name: 'Night shift · Paused' }).click();
    await popup.getByRole('button', { name: 'Programs', exact: true }).click();
    await popup.getByLabel('Filter download status').selectOption('Error');
    await popup.getByRole('searchbox').fill('EXAMPLE.TEST/FILE-5');
    await popup.getByText('Installer.bin', { exact: true }).waitFor();
    assert.equal(await popup.getByRole('article').count(), 1);
    await popup.reload();
    await popup.getByText('Installer.bin', { exact: true }).waitFor();
    assert.equal(
      await popup.getByRole('searchbox').inputValue(),
      'EXAMPLE.TEST/FILE-5',
    );
    await popup.getByRole('searchbox').fill('');
    await popup
      .getByRole('button', { name: 'All downloads', exact: true })
      .click();
    await popup
      .getByRole('button', { name: 'All queues', exact: true })
      .click();
    await popup.getByLabel('Filter download status').selectOption('');
    await popup.getByLabel('Sort downloads').selectOption('Name');
    await popup.getByRole('button', { name: 'Sort ascending' }).click();
    const region = popup.getByRole('region', { name: 'Download list' });
    await region.focus();
    await popup.keyboard.press('End');
    await popup.keyboard.press('Home');
    assert.equal(await region.evaluate((element) => element.scrollTop), 0);
    await mkdir('test-results', { recursive: true });
    await popup.screenshot({ path: 'test-results/dashboard-chrome-light.png' });
    await popup.evaluate(
      () => (document.documentElement.dataset.appearance = 'dark'),
    );
    await popup.screenshot({ path: 'test-results/dashboard-chrome-dark.png' });
    await popup.evaluate(
      () => (document.documentElement.dataset.appearance = 'light'),
    );
    await popup.getByRole('button', { name: 'Manage queues' }).click();
    await popup.getByRole('button', { name: 'Edit Night shift' }).click();
    await popup.getByRole('heading', { name: 'Night shift' }).waitFor();
    const editor = popup.getByRole('main', { name: 'Queue editor' });
    await popup.screenshot({ path: 'test-results/queue-chrome-light.png' });
    await popup.getByRole('tab', { name: 'Schedule' }).click();
    await popup.getByRole('switch', { name: 'Enable queue schedule' }).check();
    await popup.getByLabel('Repeat').selectOption('weekly');
    await popup.getByLabel('Start time', { exact: true }).fill('22:00');
    await popup.getByLabel('Stop time', { exact: true }).fill('02:00');
    await popup.getByText('The queue stops the following day.').waitFor();
    await popup.evaluate(
      () => (document.documentElement.dataset.appearance = 'dark'),
    );
    assert.equal(await background(), darkBackground);
    await popup.screenshot({ path: 'test-results/queue-chrome-dark.png' });
    await popup.setViewportSize({ width: 320, height: 260 });
    assert.deepEqual(
      await editor.evaluate((pane) => ({
        pageWidth: document.body.scrollWidth,
        scrolling: pane.scrollHeight > pane.clientHeight,
        horizontalOverflow: pane.scrollWidth > pane.clientWidth,
      })),
      { pageWidth: 320, scrolling: true, horizontalOverflow: false },
    );
    await popup
      .getByRole('button', { name: 'Save changes' })
      .scrollIntoViewIfNeeded();
    const saveBounds = await popup
      .getByRole('button', { name: 'Save changes' })
      .boundingBox();
    assert.ok(saveBounds && saveBounds.y + saveBounds.height <= 260);
    await popup.screenshot({ path: 'test-results/queue-chrome-narrow.png' });
    await popup.getByRole('button', { name: 'Cancel' }).click();
    await popup.getByRole('button', { name: 'Back to downloads' }).click();
    await popup.setViewportSize({ width: 780, height: 580 });
    await popup.evaluate(
      () => (document.documentElement.dataset.appearance = 'light'),
    );
    daemon.setOffline(true);
    await popup
      .getByText('Live updates interrupted · showing last known data', {
        exact: true,
      })
      .waitFor();
    assert.ok((await popup.getByRole('article').count()) > 0);
    await popup.screenshot({ path: 'test-results/dashboard-chrome-stale.png' });
    daemon.setOffline(false);
    await popup.getByRole('button', { name: 'Reconnect' }).click();
    await popup
      .getByText('Live updates interrupted · showing last known data', {
        exact: true,
      })
      .waitFor({ state: 'hidden' });
    daemon.setLarge(true);
    await popup.getByText('10000 results', { exact: true }).waitFor();
    assert.ok((await popup.getByRole('listitem').count()) < 20);
    await region.focus();
    await popup.keyboard.press('End');
    await popup.waitForFunction(() =>
      document.querySelector('li[aria-posinset="10000"]'),
    );
    await popup.keyboard.press('Home');
    // Headless Chrome reports background tabs as visible. Exercise the real
    // visibility event explicitly, in addition to the lifecycle render test.
    await popup.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      });
      document.dispatchEvent(new globalThis.Event('visibilitychange'));
    });
    await delay(300);
    const hiddenRequests = daemon.downloadRequests();
    await delay(1300);
    assert.equal(daemon.downloadRequests(), hiddenRequests);
    await popup.evaluate(() => {
      Reflect.deleteProperty(document, 'visibilityState');
      document.dispatchEvent(new globalThis.Event('visibilitychange'));
    });
    daemon.setLarge(false);
    await popup.getByText('7 results', { exact: true }).waitFor();
  }

  await popup.setViewportSize({ width: 320, height: 260 });
  assert.equal(
    await popup.locator('body').evaluate((body) => body.scrollWidth),
    320,
  );
  assert.equal(
    await popup
      .locator('main')
      .evaluate((main) => getComputedStyle(main).overflowY),
    'auto',
  );
  await popup.screenshot({ path: 'test-results/dashboard-chrome-narrow.png' });
  await popup.goto(`${origin}/confirmation.html`);
  await popup.getByRole('heading', { name: 'Download with Ario' }).waitFor();

  if (daemon.fixture) {
    const opened = context.waitForEvent('page');
    await popup.evaluate(openSmokeConfirmation, {
      origin: daemon.origin,
      link: smokeLink,
    });
    const confirmation = await opened;
    confirmation.setDefaultTimeout(10_000);
    await confirmation.setViewportSize({ width: 500, height: 565 });
    const card = confirmation.getByRole('region', {
      name: 'Download with Ario',
    });
    const cardColor = () =>
      card.evaluate((element) => getComputedStyle(element).backgroundColor);
    await confirmation.getByText(smokeLink, { exact: true }).waitFor();
    assert.match(confirmation.url(), /\/confirmation\.html#[\da-f-]{36}$/);
    assert.equal(await cardColor(), lightBackground);
    await confirmation.screenshot({
      path: 'test-results/confirmation-chrome-light.png',
    });
    await options.getByText('Dark', { exact: true }).click();
    await confirmation.waitForFunction(
      () => document.documentElement.dataset.appearance === 'dark',
    );
    assert.equal(await cardColor(), darkBackground);
    await confirmation.screenshot({
      path: 'test-results/confirmation-chrome-dark.png',
    });
    await confirmation.setViewportSize({ width: 320, height: 290 });
    assert.equal(
      await confirmation.locator('body').evaluate((body) => body.scrollWidth),
      320,
    );
    await confirmation.getByLabel('Queue', { exact: true }).selectOption('2');
    await confirmation.getByRole('button', { name: 'Save for later' }).click();
    await confirmation.getByText('Added to Ario.').waitFor();
    const closed = confirmation.waitForEvent('close');
    await confirmation.getByRole('button', { name: 'Close' }).click();
    await closed;
    const source = await context.newPage();
    const pageUrl = `${daemon.origin}/browser-handoff-fixture`;
    await source.goto(pageUrl);
    const privateLink = `${daemon.origin}/private/credentialed.zip`;
    const privateOpened = context.waitForEvent('page', { timeout: 10_000 });
    await popup.evaluate(openSmokeConfirmation, {
      origin: daemon.origin,
      link: privateLink,
      pageUrl,
    });
    const privateConfirmation = await privateOpened;
    privateConfirmation.setDefaultTimeout(10_000);
    const session = privateConfirmation.getByRole('checkbox', {
      name: 'Use browser session',
    });
    assert.equal(await session.isChecked(), false);
    await session.click();
    await privateConfirmation
      .locator('input[aria-describedby="browser-session-help"]:checked')
      .waitFor();
    await privateConfirmation
      .getByRole('button', { name: 'Start now' })
      .click();
    await privateConfirmation.getByText('Added to Ario.').waitFor();
    daemon.verifyHandoffs(
      {
        url: smokeLink,
        method: 'GET',
        queue_id: 2,
        finetune_override: null,
        start_immediately: false,
      },
      {
        url: privateLink,
        method: 'GET',
        queue_id: 1,
        finetune_override: null,
        start_immediately: true,
        session: { cookie: 'ario_fixture=allowed' },
      },
    );
  }

  daemon.verify();
  console.log('Chromium MV3 smoke passed.');
} finally {
  await context.close();
  await daemon?.close();
}
