import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { By, Key, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import app from '../../package.json' with { type: 'json' };
import { darkBackground, lightBackground, readBuild } from './build.mjs';
import { smokeMagnet } from './confirmation.mjs';
import { embeddedMediaPath, startTestDaemon } from './daemon.mjs';
import {
  setFormValue,
  verifyTransfer,
  verifyLiveManagement,
} from './live-workflows.mjs';

const { manifest } = await readBuild('firefox');
assert.deepEqual(manifest.background.scripts, ['background.js']);
const id = manifest.browser_specific_settings.gecko.id;

const archive = resolve(
  '.output',
  `${app.name}-${manifest.version}-firefox.zip`,
);
const uuid = randomUUID();
const downloadDir = await mkdtemp(join(tmpdir(), 'ario-capture-firefox-'));
const options = new firefox.Options()
  .addArguments('-headless')
  // Drive Firefox’s permission API without its native doorhanger in headless mode.
  .setPreference('extensions.webextOptionalPermissionPrompts', false)
  .setPreference('browser.download.folderList', 2)
  .setPreference('browser.download.dir', downloadDir)
  .setPreference('browser.download.useDownloadDir', true)
  .setPreference(
    'browser.helperApps.neverAsk.saveToDisk',
    'application/octet-stream',
  )
  .setPreference(
    'extensions.webextensions.uuids',
    JSON.stringify({ [id]: uuid }),
  );
if (process.env.FIREFOX_PATH) options.setBinary(process.env.FIREFOX_PATH);
const service = new firefox.ServiceBuilder(process.env.GECKODRIVER_PATH)
  // Firefox requires this opt-in for WebDriver navigation to extension pages.
  .setEnvironment({ ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' })
  .build();
const driver = firefox.Driver.createSession(options, service);

let daemon;
try {
  daemon = await startTestDaemon();
  assert.equal(await driver.installAddon(archive, true), id);
  const origin = `moz-extension://${uuid}`;
  const heading = (label) =>
    driver.wait(
      until.elementLocated(By.xpath(`//h1[text()="${label}"]`)),
      10_000,
    );
  const background = () =>
    driver.executeScript(
      'return getComputedStyle(document.body).backgroundColor',
    );
  const waitForTheme = (value) =>
    driver.wait(
      () =>
        driver
          .executeScript('return document.documentElement.dataset.appearance')
          .then((appearance) => appearance === value),
      10_000,
    );

  await driver.get(`${origin}/popup.html`);
  await heading('Downloads');
  assert.equal(
    await background(),
    (await driver.executeScript(
      'return matchMedia("(prefers-color-scheme: dark)").matches',
    ))
      ? darkBackground
      : lightBackground,
  );
  const popupError = await driver.executeAsyncScript((done) => {
    globalThis.browser.action.openPopup().then(
      () => done(null),
      (error) => done(error.message),
    );
  });
  assert.equal(popupError, null);
  const popupSize = await driver.wait(
    () =>
      driver.executeScript(() => {
        const [view] = globalThis.browser.extension.getViews({ type: 'popup' });
        if (view?.document.querySelector('h1')?.textContent !== 'Downloads')
          return null;
        const { clientWidth, clientHeight, scrollWidth } = view.document.body;
        return { clientWidth, clientHeight, scrollWidth };
      }),
    10_000,
    'Expected the native Firefox toolbar popup',
  );
  // Firefox's Extensions menu can constrain an unpinned action to 300px.
  assert.ok(popupSize.clientWidth >= 300 && popupSize.clientWidth <= 780);
  assert.ok(popupSize.clientHeight > 0 && popupSize.clientHeight <= 580);
  assert.equal(popupSize.scrollWidth, popupSize.clientWidth);
  await driver.executeScript(() =>
    globalThis.browser.extension.getViews({ type: 'popup' })[0].close(),
  );
  const popupHandle = await driver.getWindowHandle();
  await driver
    .findElement(By.css('button[aria-label="Open settings"]'))
    .click();
  const optionsHandle = await driver.wait(async () => {
    const handles = await driver.getAllWindowHandles();
    return handles.find((handle) => handle !== popupHandle);
  }, 10_000);
  await driver.switchTo().window(optionsHandle);
  await heading('Settings');
  assert.equal(await driver.getCurrentUrl(), `${origin}/options.html`);
  await driver.wait(
    until.elementIsEnabled(await driver.findElement(By.css('fieldset'))),
    10_000,
  );

  const address = await driver.findElement(By.id('daemon-address'));
  const button = (name) =>
    driver.wait(
      until.elementLocated(By.xpath(`//button[normalize-space(.)="${name}"]`)),
      10_000,
    );
  const waitForText = (text) =>
    driver.wait(
      until.elementLocated(By.xpath(`//*[text()="${text}"]`)),
      10_000,
    );
  await address.clear();
  await address.sendKeys('http://example.test');
  await (await button('Test connection')).click();
  await driver.wait(
    until.elementLocated(
      By.xpath('//*[@role="alert" and contains(., "Enter an HTTP address")]'),
    ),
    10_000,
  );
  await address.clear();
  await address.sendKeys(daemon.origin);
  await (await button('Test connection')).click();
  await driver.wait(
    until.elementLocated(
      By.xpath(
        '//p[text()="Connection test"]/following-sibling::*//p[text()="Connected · aria2 is ready"]',
      ),
    ),
    10_000,
  );
  await (await button('Save address')).click();
  await waitForText('Download locations');
  if (daemon.fixture) await waitForText('Asia/Tbilisi');
  await driver.switchTo().window(popupHandle);
  await waitForText('Daemon connected');
  await driver.switchTo().window(optionsHandle);
  await driver.findElement(By.xpath('//label[span[text()="Dark"]]')).click();
  await waitForTheme('dark');
  assert.equal(await background(), darkBackground);
  await driver.switchTo().window(popupHandle);
  await waitForTheme('dark');
  assert.equal(await background(), darkBackground);
  await driver.switchTo().window(optionsHandle);
  await driver.navigate().refresh();
  await waitForTheme('dark');
  assert.equal(
    await driver.findElement(By.css('input[value=dark]')).isSelected(),
    true,
  );

  assert.equal(
    await driver.findElement(By.id('daemon-address')).getProperty('value'),
    daemon.origin,
  );
  await driver.findElement(By.xpath('//label[span[text()="Light"]]')).click();
  await waitForTheme('light');
  assert.equal(await background(), lightBackground);
  await driver.switchTo().window(popupHandle);
  await waitForTheme('light');
  assert.equal(await background(), lightBackground);
  if (daemon.live) {
    const record = await verifyLiveManagement(daemon, {
      click: async (selector) => {
        const element = await driver.wait(
          until.elementLocated(By.css(selector)),
          10_000,
        );
        await driver.wait(until.elementIsEnabled(element), 10_000);
        await element.click();
      },
      button: async (name) => {
        const element = await button(name);
        await driver.wait(until.elementIsEnabled(element), 10_000);
        await element.click();
      },
      text: waitForText,
      fill: async (selector, value) => {
        const element = await driver.wait(
          until.elementLocated(By.css(selector)),
          10_000,
        );
        await driver.wait(until.elementIsEnabled(element), 10_000);
        await driver.executeScript(setFormValue, { selector, value });
      },
    });
    const details = `Download details for ${record.filename || record.url}`;
    const opener = await driver.wait(
      until.elementLocated(By.css(`[aria-label="${details}"]`)),
      10_000,
    );
    await opener.sendKeys(Key.ENTER);
    await (await button('Copy URL')).click();
    await waitForText('URL copied.');
    await (await button('Copy path')).click();
    await waitForText('Path copied.');
    await driver.actions().sendKeys(Key.ESCAPE).perform();
    await driver.wait(
      async () =>
        (await driver.switchTo().activeElement())
          .getAttribute('aria-label')
          .then((label) => label === details),
      10_000,
    );
    if (!daemon.handoff) {
      await driver.switchTo().window(optionsHandle);
      await waitForText('Upgrade the Ario daemon to enable browser downloads.');
      assert.equal(
        await driver
          .findElement(By.css('[aria-label="Capture browser downloads"]'))
          .isSelected(),
        true,
      );
      await driver.switchTo().window(popupHandle);
    }
  }
  if (daemon.fixture) {
    const click = (selector) => driver.findElement(By.css(selector)).click();
    await waitForText('Movie.mp4');
    assert.equal(
      await driver
        .findElement(By.css('[aria-label="Movie.mp4 progress"]'))
        .getAttribute('aria-valuenow'),
      '50',
    );
    for (const percent of [22, 70, 94]) {
      daemon.setProgress(percent);
      await driver.wait(
        until.elementLocated(
          By.css(
            `[aria-label="Movie.mp4 progress"][aria-valuenow="${percent}"]`,
          ),
        ),
        10_000,
      );
    }
    daemon.setProgress(50);
    await click('button[aria-label="Night shift · Paused"]');
    await click(
      'select[aria-label="Filter download status"] option[value="Error"]',
    );
    await driver
      .findElement(By.css('input[type="search"]'))
      .sendKeys('EXAMPLE.TEST/FILE-5');
    await waitForText('Installer.bin');
    assert.equal((await driver.findElements(By.css('article'))).length, 1);
    await driver.navigate().refresh();
    await waitForText('Installer.bin');
    assert.equal(
      await driver
        .findElement(By.css('input[type="search"]'))
        .getAttribute('value'),
      'EXAMPLE.TEST/FILE-5',
    );
    await driver.findElement(By.css('input[type="search"]')).clear();
    // clear() does not reliably emit React's input event in Firefox.
    await driver
      .findElement(By.css('input[type="search"]'))
      .sendKeys(' ', Key.BACK_SPACE);
    await driver
      .findElement(By.xpath('//button[span[text()="All queues"]]'))
      .click();
    await click('select[aria-label="Filter download status"] option[value=""]');
    await waitForText('Movie.mp4');
    await driver.manage().window().setRect({ width: 900, height: 800 });
    await mkdir('test-results', { recursive: true });
    await writeFile(
      'test-results/dashboard-firefox-light.png',
      await driver.takeScreenshot(),
      'base64',
    );
    await driver.switchTo().window(optionsHandle);
    await driver.findElement(By.xpath('//label[span[text()="Dark"]]')).click();
    await driver.switchTo().window(popupHandle);
    await waitForTheme('dark');
    await writeFile(
      'test-results/dashboard-firefox-dark.png',
      await driver.takeScreenshot(),
      'base64',
    );
    await click('#manage-queues');
    await click('button[aria-label="Edit Night shift"]');
    await heading('Night shift');
    await click('[role="tab"][aria-controls$="-schedule"]');
    await click('input[aria-label="Enable queue schedule"]');
    await driver.manage().window().setRect({ width: 450, height: 390 });
    await driver.wait(
      async () =>
        driver.executeScript(`
        const pane = document.querySelector('.queue-pane');
        const save = document.querySelector('.queue-footer button[type=submit]');
        return pane.scrollHeight > pane.clientHeight &&
          pane.scrollWidth === pane.clientWidth &&
          save.getBoundingClientRect().bottom <= innerHeight;
      `),
      10_000,
    );
    await writeFile(
      'test-results/queue-firefox-dark.png',
      await driver.takeScreenshot(),
      'base64',
    );
    await (await button('Cancel')).click();
    await click('button[aria-label="Back to downloads"]');
    await driver.manage().window().setRect({ width: 900, height: 800 });
    daemon.setOffline(true);
    await waitForText('Live updates interrupted · showing last known data');
    assert.ok((await driver.findElements(By.css('article'))).length > 0);
    daemon.setOffline(false);
    await (await button('Reconnect')).click();
    await driver.wait(
      async () =>
        (await driver.findElements(By.css('.dashboard-outage'))).length === 0,
      10000,
    );
    daemon.setLarge(true);
    await waitForText('10000 results');
    assert.ok((await driver.findElements(By.css('li'))).length < 20);
    const region = await driver.findElement(
      By.css('[aria-label="Download list"]'),
    );
    await region.sendKeys(Key.END);
    await driver.wait(
      until.elementLocated(By.css('li[aria-posinset="10000"]')),
      10000,
    );
    await region.sendKeys(Key.HOME);
    daemon.setLarge(false);
    await waitForText('7 results');
    await driver.manage().window().setRect({ width: 450, height: 600 });
    assert.equal(
      await driver.executeScript(
        'return document.body.scrollWidth <= innerWidth',
      ),
      true,
    );
    await writeFile(
      'test-results/dashboard-firefox-narrow.png',
      await driver.takeScreenshot(),
      'base64',
    );
  }
  await driver.switchTo().window(optionsHandle);
  await driver.findElement(By.xpath('//label[span[text()="Light"]]')).click();
  await driver.switchTo().window(popupHandle);
  await driver.get(`${origin}/confirmation.html`);
  await heading('Download with Ario');
  await waitForTheme('light');

  async function openLink(id) {
    await driver
      .actions()
      .contextClick(await driver.findElement(By.id(id)))
      .perform();
    await driver.setContext(firefox.Context.CHROME);
    try {
      const menuItem = await driver.wait(
        until.elementLocated(
          By.css(
            '#contentAreaContextMenu menuitem[label="Download with Ario"]',
          ),
        ),
        10_000,
        `Expected the native Ario menu for ${id}`,
      );
      await driver.executeScript(
        'arguments[0].doCommand(); document.getElementById("contentAreaContextMenu").hidePopup();',
        menuItem,
      );
    } finally {
      await driver.setContext(firefox.Context.CONTENT);
    }
    const handle = await driver.wait(
      async () =>
        (await driver.getAllWindowHandles()).find(
          (candidate) =>
            candidate !== popupHandle && candidate !== optionsHandle,
        ),
      10_000,
      `Expected a confirmation window for ${id}`,
    );
    await driver.switchTo().window(handle);
    await heading('Download with Ario');
    assert.match(
      await driver.getCurrentUrl(),
      /\/confirmation\.html#[\da-f-]{36}$/,
    );
    return handle;
  }
  async function closeConfirmation(handle) {
    await (await button('Close')).click();
    await driver.wait(
      async () => !(await driver.getAllWindowHandles()).includes(handle),
      10_000,
      'Expected the confirmation window to close',
    );
    await driver.switchTo().window(popupHandle);
  }

  if (daemon.handoff) {
    const source = daemon.sourceOrigin;
    await driver.get(`${source}/browser-handoff-fixture`);
    const handle = await openLink('live-link');
    const start = await button('Start now');
    await driver.wait(until.elementIsEnabled(start), 10_000);
    await start.click();
    await waitForText('Added to Ario.');
    await verifyTransfer(daemon, `${source}/capture-files/context-menu`);
    await closeConfirmation(handle);

    await driver.switchTo().window(optionsHandle);
    const enable = await driver.findElement(
      By.css('[aria-label="Capture browser downloads"]'),
    );
    await driver.wait(until.elementIsEnabled(enable), 10_000);
    await driver.wait(() => enable.isSelected(), 10_000);
    await driver.switchTo().window(popupHandle);
    await driver.get(`${source}/capture-fixture`);

    async function captureWindow(id) {
      await driver.findElement(By.id(id)).click();
      const handle = await driver.wait(
        async () =>
          (await driver.getAllWindowHandles()).find(
            (candidate) =>
              candidate !== popupHandle && candidate !== optionsHandle,
          ),
        10_000,
      );
      await driver.switchTo().window(handle);
      await heading('Download with Ario');
      return handle;
    }
    const kept = await captureWindow('capture-keep');
    await (await button('Keep in browser')).click();
    await waitForText('The download is continuing in your browser.');
    await closeConfirmation(kept);
    const captured = await captureWindow('capture-live');
    const submit = await button('Start now');
    await driver.wait(until.elementIsEnabled(submit), 10_000);
    await submit.click();
    await waitForText('Added to Ario.');
    await verifyTransfer(daemon, `${source}/capture-files/live`);
    await closeConfirmation(captured);
    await driver.switchTo().window(optionsHandle);
    await driver.wait(
      async () =>
        driver.executeAsyncScript(async (done) => {
          const downloads = await globalThis.browser.downloads.search({});
          done(
            downloads.some(
              ({ url, state }) =>
                url.endsWith('/capture-files/keep') && state === 'complete',
            ) &&
              downloads.some(
                ({ url, state, error }) =>
                  url.endsWith('/capture-files/live') &&
                  state === 'interrupted' &&
                  error === 'USER_CANCELED',
              ),
          );
        }),
      10_000,
    );
  }

  if (daemon.fixture) {
    await driver.get(`${daemon.origin}/browser-handoff-fixture`);
    const confirmationHandle = await openLink('magnet-link');
    await waitForText('Fixture torrent');
    await waitForTheme('light');
    const cardColor = () =>
      driver.executeScript(
        'return getComputedStyle(document.querySelector("section")).backgroundColor',
      );
    assert.equal(await cardColor(), lightBackground);
    await writeFile(
      'test-results/confirmation-firefox-light.png',
      await driver.takeScreenshot(),
      'base64',
    );
    await driver.switchTo().window(optionsHandle);
    await driver.findElement(By.xpath('//label[span[text()="Dark"]]')).click();
    await driver.switchTo().window(confirmationHandle);
    await waitForTheme('dark');
    assert.equal(await cardColor(), darkBackground);
    await writeFile(
      'test-results/confirmation-firefox-dark.png',
      await driver.takeScreenshot(),
      'base64',
    );
    const startNow = await driver.findElement(
      By.xpath('//button[normalize-space(.)="Start now"]'),
    );
    await driver.wait(
      until.elementIsEnabled(startNow),
      10_000,
      'Expected the magnet confirmation to be ready',
    );
    await startNow.click();
    await driver.wait(
      until.elementLocated(By.xpath('//*[text()="Added to Ario."]')),
      10_000,
      'Expected Ario to commit the magnet',
    );
    await closeConfirmation(confirmationHandle);

    const privateHandle = await openLink('private-link');
    await driver.wait(
      until.elementLocated(By.xpath('//bdi[text()="credentialed.zip"]')),
      10_000,
      'Expected the credentialed link in its confirmation',
    );
    const session = await driver.wait(
      until.elementLocated(
        By.css(
          'input[type="checkbox"][aria-describedby="browser-session-help"]',
        ),
      ),
      10_000,
      'Expected the browser session checkbox',
    );
    assert.equal(await session.isSelected(), false);
    await session.click();
    await driver.wait(
      async () => {
        const reason = await driver
          .findElement(By.id('browser-session-help'))
          .getText();
        assert.doesNotMatch(reason, /denied|could not be identified/);
        return session.isSelected();
      },
      10_000,
      'Expected Firefox to grant cookie access',
    );
    await (await button('Save for later')).click();
    await driver.wait(
      async () => {
        const [alert] = await driver.findElements(By.css('[role="alert"]'));
        if (alert) assert.fail(await alert.getText());
        return (
          (await driver.findElements(By.xpath('//*[text()="Added to Ario."]')))
            .length > 0
        );
      },
      10_000,
      'Expected Ario to commit the credentialed link',
    );
    await closeConfirmation(privateHandle);

    daemon.verifyHandoffs(
      {
        url: smokeMagnet,
        queue_id: 1,
        finetune_override: null,
        start_immediately: true,
      },
      {
        url: `${daemon.origin}/private/credentialed.zip`,
        method: 'GET',
        queue_id: 1,
        finetune_override: null,
        start_immediately: false,
        session: { cookie: 'ario_fixture=allowed' },
      },
    );
    await driver.switchTo().window(optionsHandle);
    const captureSwitch = (name) =>
      driver.findElement(By.css(`input[role="switch"][aria-label="${name}"]`));
    const enable = await captureSwitch('Capture browser downloads');
    await driver.wait(until.elementIsEnabled(enable), 10_000);
    await driver.wait(
      () => enable.isSelected(),
      10_000,
      'Expected capture to be enabled by default',
    );
    await driver.switchTo().newWindow('tab');
    const captureSource = await driver.getWindowHandle();
    await driver.get(`${daemon.origin}/capture-fixture`);

    async function captureWindow(id) {
      const previous = await driver.getAllWindowHandles();
      await driver.findElement(By.id(id)).click();
      const handle = await driver.wait(
        async () =>
          (await driver.getAllWindowHandles()).find(
            (candidate) => !previous.includes(candidate),
          ),
        8000,
        `Expected a Firefox capture window for ${id}`,
      );
      await driver.switchTo().window(handle);
      await waitForText('Browser download');
      return handle;
    }
    const kept = await captureWindow('capture-keep');
    await (await button('Keep in browser')).click();
    await waitForText('The download is continuing in your browser.');
    await closeConfirmation(kept);
    await driver.switchTo().window(captureSource);
    const asked = await captureWindow('capture-ask');
    await writeFile(
      'test-results/capture-firefox-dark.png',
      await driver.takeScreenshot(),
      'base64',
    );
    await driver
      .findElement(By.css('#confirmation-queue option[value="2"]'))
      .click();
    await driver
      .findElement(
        By.xpath(
          '//label[.//span[contains(text(), "Don’t show me again")]]/input',
        ),
      )
      .click();
    await (await button('Save for later')).click();
    await waitForText('Added to Ario.');
    await closeConfirmation(asked);

    await driver.switchTo().window(optionsHandle);
    assert.equal(
      await (await captureSwitch('Ask before downloading')).isSelected(),
      false,
    );
    const useSession = await captureSwitch('Use browser session');
    await useSession.click();
    await driver.wait(() => useSession.isSelected(), 10_000);
    await driver.switchTo().window(captureSource);
    await driver.findElement(By.id('capture-automatic')).click();
    await driver.wait(
      () =>
        daemon.captureHandoffs().length === 2 &&
        daemon.captureHandoffs()[1].state === 'committed',
      8000,
    );
    assert.deepEqual(
      daemon
        .captureHandoffs()
        .map(({ payload, state }) => [
          payload.url,
          payload.queue_id,
          payload.start_immediately,
          payload.session,
          state,
        ]),
      [
        [
          `${daemon.origin}/capture-files/ask`,
          2,
          false,
          undefined,
          'committed',
        ],
        [
          `${daemon.origin}/capture-files/cookie?signature=x%2Fz%2B`,
          1,
          true,
          {
            cookie: 'capture_session=fixture',
            referrer: `${daemon.origin}/capture-fixture`,
          },
          'committed',
        ],
      ],
    );
    await driver.findElement(By.id('capture-post')).click();
    await driver.switchTo().window(optionsHandle);
    await driver.wait(
      () =>
        driver.executeAsyncScript(`
      const done = arguments[0];
      browser.downloads.search({}).then((downloads) => done(
        ['/keep', '/post'].every((suffix) =>
          downloads.some(({ url, state }) => url.endsWith(suffix) && state === 'complete')
        ) && downloads.some(({ url, state, error }) =>
          url.endsWith('/ask') && state === 'interrupted' && error === 'USER_CANCELED'
        )
      ));
    `),
      10_000,
      'Expected browser history to keep the resumed, POST, and canceled downloads',
    );
    assert.equal(daemon.captureHandoffs().length, 2);

    const ask = await captureSwitch('Ask before downloading');
    await ask.click();
    await driver.wait(() => ask.isSelected(), 10_000);
    await driver.switchTo().window(captureSource);
    const paused = await captureWindow('capture-disable');
    await driver.switchTo().window(optionsHandle);
    await enable.click();
    await driver.wait(
      async () => !(await enable.isSelected()),
      10_000,
      'Expected Firefox capture to turn off in Settings',
    );
    await driver.switchTo().window(paused);
    await waitForText('The download is continuing in your browser.');
    await closeConfirmation(paused);
  }

  if (daemon.fixture) {
    await driver.switchTo().newWindow('tab');
    const mediaSource = await driver.getWindowHandle();
    await driver.get(`${daemon.origin}/media-fixture`);
    async function mediaButton() {
      const wrapper = await driver.wait(
        until.elementLocated(By.css('[data-ario-media]')),
        10_000,
      );
      return (await wrapper.getShadowRoot()).findElement(By.css('button'));
    }
    assert.equal(await (await mediaButton()).getText(), 'Download with Ario');
    await driver.switchTo().frame(await driver.findElement(By.css('iframe')));
    const inFrame = await mediaButton();
    const previous = await driver.getAllWindowHandles();
    await inFrame.click();
    const confirmation = await driver.wait(
      async () =>
        (await driver.getAllWindowHandles()).find(
          (handle) => !previous.includes(handle),
        ),
      10_000,
    );
    await driver.switchTo().window(confirmation);
    const save = await button('Save for later');
    await driver.wait(until.elementIsEnabled(save), 10_000);
    await save.click();
    await waitForText('Added to Ario.');
    await driver.close();
    assert.deepEqual(
      daemon.mediaAdds.map(({ inputs }) => inputs[0].Url),
      [`${daemon.origin}${embeddedMediaPath}`],
    );

    await driver.switchTo().window(popupHandle);
    await driver.get(`${origin}/popup.html`);
    await heading('Downloads');
    await driver.executeAsyncScript(
      `
      const [url, done] = arguments;
      browser.tabs.query({}).then((tabs) => browser.tabs.update(tabs.find((tab) => tab.url === url).id, { active: true })).then(() => {
        [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Media').click();
        done();
      });
    `,
      `${daemon.origin}/media-fixture`,
    );
    await waitForText('clip.wav');
    await waitForText('media-redirect');

    await driver.switchTo().window(optionsHandle);
    const detection = await driver.findElement(
      By.css('[aria-describedby="media-settings-description"]'),
    );
    assert.equal(await detection.isSelected(), true);
    await detection.click();
    await driver.wait(async () => !(await detection.isSelected()), 10_000);
    await driver.switchTo().window(mediaSource);
    await driver.wait(
      async () =>
        !(await driver.findElements(By.css('[data-ario-media]'))).length,
      10_000,
    );
    await driver.switchTo().frame(await driver.findElement(By.css('iframe')));
    await driver.wait(
      async () =>
        !(await driver.findElements(By.css('[data-ario-media]'))).length,
      10_000,
    );
  }

  daemon.verify();
  console.log('Firefox MV3 smoke passed.');
} finally {
  await driver.quit();
  await daemon?.close();
  await rm(downloadDir, { recursive: true, force: true });
}
