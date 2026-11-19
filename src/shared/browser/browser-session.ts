import { browser, type Browser } from 'wxt/browser';
import { ArioError } from '@/shared/types/connection';

export type SessionSource = { tabId: number; pageUrl: string };

export function sessionSource(
  link: URL,
  info: Browser.contextMenus.OnClickData,
  tab: Browser.tabs.Tab | undefined,
): SessionSource | null {
  if (
    link.protocol === 'magnet:' ||
    (info.frameId ?? 0) !== 0 ||
    tab?.id === undefined ||
    tab.incognito
  )
    return null;

  const page = info.pageUrl ? URL.parse(info.pageUrl) : null;
  if (!page || page.origin !== link.origin || page.username || page.password)
    return null;
  if (info.frameUrl && URL.parse(info.frameUrl)?.href !== page.href)
    return null;
  page.hash = '';
  return { tabId: tab.id, pageUrl: page.href };
}

export function sessionHostPattern(url: URL) {
  return `${url.protocol}//${url.hostname}/*`;
}

export function sessionPermissions(
  host: string,
): Browser.permissions.Permissions {
  return { permissions: ['cookies'], origins: [host] };
}

function sessionError(reason: string) {
  return new ArioError({
    kind: 'extension',
    message: `${reason} Turn off browser session to send the public link, or go back to the browser.`,
  });
}

function isSourceTab(tab: Browser.tabs.Tab, source: SessionSource) {
  const page = tab.url ? URL.parse(tab.url) : null;
  if (page) page.hash = '';
  return !tab.incognito && !tab.pendingUrl && page?.href === source.pageUrl;
}

type Cookie = Browser.cookies.Cookie;
type CookieQuery = Browser.cookies.GetAllDetails;

function isTopLevelPartition(
  key: Browser.cookies.CookiePartitionKey,
  page: URL,
) {
  const site = key.topLevelSite ? URL.parse(key.topLevelSite) : null;
  // The browser supplies the registrable site. Verify its scheme and domain
  // boundary against the original top-level page.
  return (
    site &&
    !key.hasCrossSiteAncestor &&
    site.protocol === page.protocol &&
    (!site.port || site.port === page.port) &&
    (site.hostname === page.hostname ||
      page.hostname.endsWith(`.${site.hostname}`))
  );
}

async function readApplicableCookies(
  query: CookieQuery,
  source: SessionSource,
): Promise<Cookie[]> {
  const page = new URL(source.pageUrl);
  // Firefox derives the schemeful site from the supplied top-level URL.
  // Chromium supplies the partition key directly for the source frame.
  const partitionKey = import.meta.env.FIREFOX
    ? { topLevelSite: page.origin, hasCrossSiteAncestor: false }
    : (
        await browser.cookies.getPartitionKey({
          tabId: source.tabId,
          frameId: 0,
        })
      ).partitionKey;
  if (!isTopLevelPartition(partitionKey, page))
    throw sessionError(
      'The browser could not identify the link’s cookie partition.',
    );
  const [ordinary, partitioned] = await Promise.all([
    browser.cookies.getAll(query),
    browser.cookies.getAll({ ...query, partitionKey }),
  ]);
  const applicable = partitioned.filter(
    (cookie) =>
      cookie.partitionKey &&
      isTopLevelPartition(cookie.partitionKey, page) &&
      (import.meta.env.FIREFOX ||
        cookie.partitionKey.topLevelSite === partitionKey.topLevelSite),
  );
  const unpartitioned = ordinary.filter((cookie) => !cookie.partitionKey);
  // Separate jar queries cannot tell us the relative creation order.
  if (
    applicable.some((cookie) =>
      unpartitioned.some(
        (other) =>
          cookie.name === other.name &&
          cookie.path.length === other.path.length,
      ),
    )
  )
    throw sessionError(
      'The browser returned conflicting cookies for this link.',
    );
  return [...unpartitioned, ...applicable];
}

export async function readSessionCookie(
  url: URL,
  source: SessionSource | null,
) {
  if (!source || URL.parse(source.pageUrl)?.origin !== url.origin)
    throw sessionError('This link’s browser session could not be identified.');

  try {
    if (
      !(await browser.permissions.contains(
        sessionPermissions(sessionHostPattern(url)),
      ))
    )
      throw sessionError('Cookie access was denied or removed.');

    const tab = await browser.tabs.get(source.tabId);
    if (!isSourceTab(tab, source))
      throw sessionError('The page that opened this confirmation has changed.');

    const stores = (await browser.cookies.getAllCookieStores()).filter(
      (store) => store.tabIds.includes(source.tabId),
    );
    const [store] = stores;
    if (!store || stores.length !== 1)
      throw sessionError(
        'The browser could not identify the link’s cookie store.',
      );

    const cookies = await readApplicableCookies(
      { url: url.href, storeId: store.id },
      source,
    );
    if (!isSourceTab(await browser.tabs.get(source.tabId), source))
      throw sessionError('The page that opened this confirmation has changed.');

    if (!cookies.length)
      throw sessionError(
        'The browser has no applicable cookies for this link.',
      );

    const header = cookies
      .sort((left, right) => right.path.length - left.path.length)
      .map(({ name, value }) => `${name}=${value}`)
      .join('; ');
    if (
      header.length > 8192 ||
      header.trim() !== header ||
      !/^[ -~]+$/.test(header)
    )
      throw sessionError(
        'The browser cookies cannot be sent in a download request.',
      );
    return header;
  } catch (error) {
    if (error instanceof ArioError) throw error;
    throw sessionError(
      'The browser could not verify the cookies for this link.',
    );
  }
}
