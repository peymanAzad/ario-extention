import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const darkBackground = 'rgb(23, 28, 27)';
export const lightBackground = 'rgb(255, 255, 255)';

export async function readBuild(browser) {
  const directory = resolve('.output', `${browser}-mv3`);
  const manifest = JSON.parse(
    await readFile(resolve(directory, 'manifest.json'), 'utf8'),
  );

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.toSorted(), [
    'contextMenus',
    'storage',
  ]);
  assert.deepEqual(manifest.optional_permissions, ['cookies']);
  assert.deepEqual(manifest.optional_host_permissions.toSorted(), [
    'http://*/*',
    'https://*/*',
  ]);
  assert.deepEqual(
    manifest.host_permissions.toSorted(),
    ['http://127.0.0.1/*', 'http://[::1]/*', 'http://localhost/*'].toSorted(),
  );
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.equal(manifest.options_ui.page, 'options.html');

  return { directory, manifest };
}
