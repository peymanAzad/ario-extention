import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { By, Key, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import app from '../../package.json' with { type: 'json' };
import { darkBackground, lightBackground, readBuild } from './build.mjs';
import { startTestDaemon } from './daemon.mjs';

const { manifest } = await readBuild('firefox');
assert.deepEqual(manifest.background.scripts, ['background.js']);
const id = manifest.browser_specific_settings.gecko.id;

const archive = resolve(
  '.output',
  `${app.name}-${manifest.version}-firefox.zip`,
);
const uuid = randomUUID();
const options = new firefox.Options()
  .addArguments('-headless')
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
    driver.findElement(By.xpath(`//button[text()="${name}"]`));
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
  if (daemon.fixture) {
    const click = (selector) => driver.findElement(By.css(selector)).click();
    await waitForText('Movie.mp4');
    assert.equal(
      await driver
        .findElement(By.css('[aria-label="Movie.mp4 progress"]'))
        .getAttribute('aria-valuenow'),
      '50',
    );
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

  daemon.verify();
  console.log('Firefox MV3 smoke passed.');
} finally {
  await driver.quit();
  await daemon?.close();
}
