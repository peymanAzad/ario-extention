import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { darkBackground, lightBackground, readBuild } from './build.mjs';

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

try {
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
  await options.getByText('Dark', { exact: true }).click();
  await popup.waitForFunction(
    () => document.documentElement.dataset.appearance === 'dark',
  );
  assert.equal(await background(), darkBackground);

  await options.reload();
  await options.waitForFunction(
    () => document.querySelector('input[value=dark]').checked,
  );
  await options.getByText('Light', { exact: true }).click();
  await popup.waitForFunction(
    () => document.documentElement.dataset.appearance === 'light',
  );
  assert.equal(await background(), lightBackground);

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
  await popup.goto(`${origin}/confirmation.html`);
  await popup.getByRole('heading', { name: 'Download with Ario' }).waitFor();

  console.log('Chromium MV3 smoke passed.');
} finally {
  await context.close();
}
