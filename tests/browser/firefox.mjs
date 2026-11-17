import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { By, until } from 'selenium-webdriver';
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
  await driver.get(`${origin}/confirmation.html`);
  await heading('Download with Ario');
  await waitForTheme('light');

  daemon.verify();
  console.log('Firefox MV3 smoke passed.');
} finally {
  await driver.quit();
  await daemon?.close();
}
