import { fakeBrowser } from '@webext-core/fake-browser';
import { expect, it, vi } from 'vitest';
import { createMedia } from '@/shared/browser/media';
import { updateSettings } from '@/shared/storage/settings';
import { isDirectMedia, mediaUrl } from '@/shared/types/media';

it('classifies direct files without treating known manifests, segments, or opaque URLs as media files', () => {
  const url = 'https://media.example.test/video?signature=a%2Fb%2B';
  expect(mediaUrl(url)).toBe(url);
  expect(isDirectMedia(url, 'video/mp4; profile=main')).toBe(true);
  expect(isDirectMedia(url)).toBe(false);
  expect(isDirectMedia('https://media.example.test/clip.MP4')).toBe(true);
  expect(
    isDirectMedia(
      'https://media.example.test/song.m4a',
      'application/octet-stream',
    ),
  ).toBe(true);
  expect(
    isDirectMedia('https://media.example.test/clip.mp4', 'text/html'),
  ).toBe(false);
  expect(isDirectMedia(url, 'application/vnd.apple.mpegurl')).toBe(false);
  expect(isDirectMedia(url, 'application/dash+xml')).toBe(false);
  expect(
    isDirectMedia(url, 'video/mp4', 'https://media.example.test/clip.m4s'),
  ).toBe(false);
  expect(
    isDirectMedia('https://media.example.test/live.m3u8', 'video/mp4'),
  ).toBe(false);
  expect(mediaUrl('blob:https://media.example.test/stream')).toBeUndefined();
  expect(mediaUrl('data:video/mp4;base64,xyz')).toBeUndefined();
  expect(
    mediaUrl('https://user:pass@media.example.test/clip.mp4'),
  ).toBeUndefined();
});

it('lists verified active-tab sources, deduplicates frames, and authorizes only the owning player', async () => {
  const url = 'https://media.example.test/clip.mp4?signature=a%2Fb';
  const page = 'https://media.example.test/player';
  const tab = await fakeBrowser.tabs.create({ url: page });
  const second = await fakeBrowser.tabs.create({ url: page });
  let active = tab;
  vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation(async () => [active]);
  const verify = vi
    .spyOn(fakeBrowser.tabs, 'sendMessage')
    .mockImplementation(async () => true);
  const open = vi.fn(async () => {});
  const manager = createMedia(open);
  const report = {
    operation: 'media.report',
    document: '1'.repeat(32),
    sources: [{ url, kind: 'video' }],
  };
  const main = { id: fakeBrowser.runtime.id, tab, url: page, frameId: 0 };
  const embed = { ...main, frameId: 3 };
  expect(
    manager.onPageMessage(report, { ...main, id: 'another-extension' }),
  ).toBeUndefined();
  expect(
    manager.onPageMessage(
      { ...report, origin: 'https://arbitrary.test' },
      main,
    ),
  ).toBeUndefined();
  await manager.onPageMessage(report, main);
  await manager.onPageMessage({ ...report, document: '2'.repeat(32) }, embed);
  const [item] = await manager.list();
  expect(await manager.list()).toEqual([{ ...item, url, kind: 'video' }]);
  const click = {
    operation: 'media.playerOpen',
    id: item!.id,
    document: report.document,
  };
  await expect(manager.onPageMessage(click, embed)).resolves.toMatchObject({
    ok: false,
  });
  await expect(manager.openFromPopup(item!.id)).resolves.toBeUndefined();
  expect(open).toHaveBeenCalledExactlyOnceWith(url);

  active = second;
  await expect(manager.list()).resolves.toEqual([]);
  await expect(manager.openFromPopup(item!.id)).rejects.toThrow(
    'no longer available',
  );
  active = tab;
  verify.mockImplementation(async () => false);
  await expect(manager.list()).resolves.toEqual([]);
  await expect(manager.openFromPopup(item!.id)).rejects.toThrow(
    'no longer available',
  );
  await updateSettings({ detectMedia: false });
  await expect(manager.onPageMessage(report, main)).resolves.toEqual({
    ok: true,
    data: [],
  });
});
