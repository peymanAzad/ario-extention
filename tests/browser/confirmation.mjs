export const smokeLink =
  'https://example.test/context-menu.zip?signature=fixture';
export const smokeMagnet = `magnet:?xt=urn:btih:${'a'.repeat(40)}&dn=Fixture+torrent`;

// Playwright cannot select entries in Chromium's native link menu. Seed the
// draft in the same storage area as the background and open its actual page.
export async function openSmokeConfirmation({ origin, link, pageUrl }) {
  const api = globalThis.browser ?? globalThis.chrome;
  const id = globalThis.crypto.randomUUID();
  const [sourceTab] = pageUrl ? await api.tabs.query({ url: pageUrl }) : [];
  if (pageUrl && sourceTab?.id === undefined)
    throw new Error('The browser fixture tab is unavailable.');
  const confirmation = await api.windows.create({
    type: 'popup',
    url: 'about:blank',
    focused: true,
    width: 500,
    height: 565,
  });
  await api.storage.session.set({
    [`arioConfirmation:${id}`]: {
      windowId: confirmation.id,
      url: link,
      origin,
      source: sourceTab ? { tabId: sourceTab.id, pageUrl } : null,
    },
  });
  await api.tabs.update(confirmation.tabs[0].id, {
    url: `${api.runtime.getURL('confirmation.html')}#${id}`,
  });
}
