import { browser, type Browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { settingsKey } from '@/shared/storage/settings-key';
import { mediaLimit, mediaUrl } from '@/shared/types/links';
import type {
  DetectedMedia,
  MediaPageMessage,
  MediaSource,
} from '@/shared/types/media';
import type { BackgroundReply } from '@/shared/types/messages';

const playerEvents = [
  'loadedmetadata',
  'durationchange',
  'emptied',
  'error',
  'encrypted',
];

function detectsMedia(settings: unknown) {
  if (settings === undefined) return true;
  if (typeof settings !== 'object' || settings === null) return false;
  const preference = (settings as { detectMedia?: unknown }).detectMedia;
  return preference === undefined || preference === true;
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  allFrames: true,
  runAt: 'document_start',
  main(context) {
    const documentId = Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
    const encrypted = new WeakMap<HTMLMediaElement, string>();
    const buttons = new Map<
      HTMLMediaElement,
      { id: string; host: HTMLElement }
    >();
    let enabled = false;
    let started = false;
    let visible = !(document as Document & { prerendering?: boolean })
      .prerendering;
    let nextScan: number | undefined;
    let revision = 0;

    async function send<T>(message: MediaPageMessage) {
      const reply: BackgroundReply<T> =
        await browser.runtime.sendMessage(message);
      if (!reply?.ok)
        throw new Error(reply?.error.message ?? 'Ario is unavailable.');
      return reply.data;
    }

    function source(player: HTMLMediaElement): MediaSource | undefined {
      const url = mediaUrl(player.currentSrc);
      if (
        !url ||
        player.readyState < HTMLMediaElement.HAVE_METADATA ||
        !Number.isFinite(player.duration) ||
        player.duration <= 0 ||
        player.error ||
        player.mediaKeys ||
        encrypted.get(player) === url
      )
        return;
      return { url, kind: player.localName === 'audio' ? 'audio' : 'video' };
    }

    function players() {
      return [
        ...document.querySelectorAll<HTMLMediaElement>('video, audio'),
      ].flatMap((player) => {
        const selected = source(player);
        return selected ? [{ player, selected }] : [];
      });
    }

    function mountButton(player: HTMLMediaElement, candidate: DetectedMedia) {
      const host = document.createElement('span');
      host.dataset.arioMedia = '';
      host.style.setProperty('display', 'inline-block', 'important');
      const root = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `
        :host { color-scheme: light dark; }
        button {
          font: 600 13px system-ui, sans-serif;
          border: 1px solid ButtonText;
          border-radius: 5px;
          padding: 4px 8px;
          margin: 3px;
          color: ButtonText;
          background: ButtonFace;
          cursor: pointer;
        }
        button:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
      `;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Download with Ario';
      button.addEventListener('click', (event) => {
        if (
          !event.isTrusted ||
          !enabled ||
          source(player)?.url !== candidate.url
        )
          return;
        button.disabled = true;
        void send<null>({
          operation: 'media.playerOpen',
          document: documentId,
          id: candidate.id,
        })
          .then(
            () => {
              button.textContent = 'Download with Ario';
            },
            () => {
              button.textContent = 'Could not open Ario · Try again';
            },
          )
          .finally(() => {
            button.disabled = false;
          });
      });
      root.append(style, button);
      player.after(host);
      return host;
    }

    function setButtons(found: DetectedMedia[]) {
      const byUrl = new Map(
        found.map((candidate) => [candidate.url, candidate]),
      );
      const wanted = found.length
        ? new Map(
            players().flatMap(({ player, selected }) => {
              const candidate = byUrl.get(selected.url);
              return candidate ? [[player, candidate] as const] : [];
            }),
          )
        : new Map<HTMLMediaElement, DetectedMedia>();
      for (const [player, entry] of buttons) {
        if (wanted.get(player)?.id === entry.id && entry.host.isConnected)
          continue;
        entry.host.remove();
        buttons.delete(player);
      }
      for (const [player, candidate] of wanted) {
        if (!buttons.has(player))
          buttons.set(player, {
            id: candidate.id,
            host: mountButton(player, candidate),
          });
      }
    }

    async function scan() {
      if (!enabled || !visible) return;
      const current = ++revision;
      const sources = [
        ...new Map(
          players().map(({ selected }) => [selected.url, selected]),
        ).values(),
      ].slice(0, mediaLimit);
      const found = await send<DetectedMedia[]>({
        operation: 'media.report',
        document: documentId,
        sources,
      }).catch(() => []);
      if (current === revision && enabled && visible) setButtons(found);
    }

    function queueScan() {
      if (nextScan !== undefined || !enabled || !visible) return;
      nextScan = window.setTimeout(() => {
        nextScan = undefined;
        void scan();
      }, 50);
    }

    const changes = new MutationObserver((records) => {
      if (
        records.some(
          ({ type, target, addedNodes, removedNodes }) =>
            (type === 'attributes' &&
              target instanceof Element &&
              target.matches('video, audio, source')) ||
            [...addedNodes, ...removedNodes].some(
              (node) =>
                node instanceof Element &&
                (node.matches('video, audio, source') ||
                  node.querySelector('video, audio, source')),
            ),
        )
      )
        queueScan();
    });

    function playerChanged(event: Event) {
      if (!(event.target instanceof HTMLMediaElement)) return;
      if (event.type === 'encrypted') {
        const url = mediaUrl(event.target.currentSrc);
        if (url) encrypted.set(event.target, url);
      }
      queueScan();
    }

    function setEnabled(value: boolean) {
      if (started && value === enabled) return;
      started = true;
      enabled = value;
      revision++;
      if (enabled) {
        for (const event of playerEvents)
          document.addEventListener(event, playerChanged, true);
        changes.observe(document, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['src'],
        });
        queueScan();
      } else {
        for (const event of playerEvents)
          document.removeEventListener(event, playerChanged, true);
        changes.disconnect();
        setButtons([]);
      }
    }

    function onMessage(
      message: { operation?: string; document?: string; url?: string },
      sender: { id?: string },
      respond: (verified: boolean) => void,
    ) {
      if (sender.id !== browser.runtime.id || !enabled || !visible) return;
      if (message?.operation === 'media.refresh') queueScan();
      if (message?.operation === 'media.verify') {
        respond(
          message.document === documentId &&
            (!message.url ||
              players().some(({ selected }) => selected.url === message.url)),
        );
      }
    }

    browser.runtime.onMessage.addListener(onMessage);
    context.addEventListener(window, 'pagehide', () => {
      visible = false;
      revision++;
      setButtons([]);
      if (enabled)
        void send<DetectedMedia[]>({
          operation: 'media.report',
          document: documentId,
          sources: [],
        }).catch(() => {});
    });
    context.addEventListener(window, 'pageshow', () => {
      visible = true;
      queueScan();
    });
    context.addEventListener(document, 'prerenderingchange', () => {
      visible = true;
      queueScan();
    });

    function settingsChanged(
      values: Record<string, Browser.storage.StorageChange>,
      area: string,
    ) {
      if (area === 'local' && settingsKey in values)
        setEnabled(detectsMedia(values[settingsKey]?.newValue));
    }
    browser.storage.onChanged.addListener(settingsChanged);
    void browser.storage.local
      .get(settingsKey)
      .then((values) => {
        if (!started) setEnabled(detectsMedia(values[settingsKey]));
      })
      .catch(() => {});
    context.onInvalidated(() => {
      browser.storage.onChanged.removeListener(settingsChanged);
      browser.runtime.onMessage.removeListener(onMessage);
      if (nextScan !== undefined) window.clearTimeout(nextScan);
      setEnabled(false);
    });
  },
});
