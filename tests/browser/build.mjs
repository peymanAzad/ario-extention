import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const darkBackground = 'rgb(30, 30, 46)';
export const lightBackground = 'rgb(239, 241, 245)';

export async function readBuild(browser) {
  const directory = resolve('.output', `${browser}-mv3`);
  const manifest = JSON.parse(
    await readFile(resolve(directory, 'manifest.json'), 'utf8'),
  );

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.toSorted(), [
    'alarms',
    'contextMenus',
    'downloads',
    'storage',
    'webRequest',
  ]);
  assert.deepEqual(manifest.optional_permissions, ['cookies']);
  assert.deepEqual(manifest.host_permissions.toSorted(), [
    'http://*/*',
    'http://127.0.0.1/*',
    'http://[::1]/*',
    'http://localhost/*',
    'https://*/*',
  ]);
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.equal(manifest.options_ui.page, 'options.html');
  assert.deepEqual(manifest.content_scripts, [
    {
      matches: ['http://*/*', 'https://*/*'],
      all_frames: true,
      run_at: 'document_start',
      js: ['content-scripts/media.js'],
    },
  ]);

  return { directory, manifest };
}
