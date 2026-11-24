# Store materials and release checks

## Listing

**Name** Ario

**Short description** Manage downloads, queues, and schedules with a local Ario daemon.

**Full description**

Ario brings the local Ario download manager to your browser toolbar. Check progress, search downloads, add web links, magnets or torrent files, and organize downloads into queues with their own schedules.

Ario requires a separately installed Ario daemon and aria2 on the same desktop computer. A daemon that supports browser handoff protocol version 1 adds **Download with Ario** to supported link workflows and enables automatic detection of eligible browser downloads. Capture asks which queue and settings to use by default. You can apply saved defaults automatically or turn capture off in Settings.

With capture enabled, Ario observes recent HTTP(S) requests to identify eligible browser downloads and passes their URLs and file details to your local daemon. You can separately choose to share applicable cookies and referrer to complete a download from a site where you are signed in. The extension has no analytics or developer-operated data collection service.

The Media view lists direct audio and video detected on the current tab. Supported players also show a download button. Media detection is on by default and has a separate setting. Ario sends a direct file URL to the daemon after you confirm.

## Browser permissions

| Permission          | Use                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `storage`           | Save local preferences, temporary confirmation drafts, and handoff recovery state.                                             |
| `contextMenus`      | Add **Download with Ario** to browser link menus.                                                                              |
| `alarms`            | Reconcile incomplete handoffs after the background has been suspended.                                                         |
| Loopback HTTP hosts | Reach the separately installed Ario daemon at the configured local port.                                                       |
| `downloads`         | Find, pause, cancel, and resume browser downloads during capture and recovery.                                                 |
| `webRequest`        | Observe HTTP(S) requests and redirects to match an eligible download and safely reproduce its GET request.                     |
| HTTP(S) sites       | Observe eligible download requests and detect direct media on the current page when the corresponding features are enabled.    |
| Optional `cookies`  | Retrieve cookies that apply to an eligible same-origin context-menu link after you enable session sharing in its confirmation. |

In Firefox, the manifest discloses browsing activity, website activity, and website content because user-selected links, supported download details, and explicitly shared session context go to the local daemon. Capture is on by default, and session sharing requires opt-in. Chrome's dashboard disclosures should cover website content, web activity, and authentication information such as cookies, including these local uses. [Ario privacy notice](PRIVACY.md), [Mozilla data consent reference](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/), [Chrome privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)

## Capture limitations

- Capture needs a recent, unambiguous HTTP(S) GET. Private windows, POST requests, downloads initiated by other extensions, and requests with unsupported headers or missing redirect details remain with the browser. Short downloads can complete before Ario can pause them. Firefox also needs partial bytes before it can safely pause a download. Danger handling depends on the browser's download metadata.
- Session sharing is off by default. Captures use only supported context from the observed final request. Context-menu confirmations can share cookies for a known same-origin top-level page. They can also submit a public HTTP(S) or BitTorrent v1 magnet link without cookies.
- Signed or single-use URLs can expire or be consumed before the daemon fetches them. If a paused download can be restored, Ario resumes it. Some interrupted cases require a manual resume or retry in browser download history. Check the popup for pending confirmations and recovery guidance.
- Local file opening, native daemon launch or shutdown, remote daemons, and mobile browsers are outside the extension's scope. Download Details can copy the destination path.

## Assets and submission

Use the [128 px icon](../../src/public/icon/128.png), [440 × 280 Chrome tile](chrome-tile.png), and 1280 × 800 screenshots of the production UI loaded with fixture data. The dashboard and queue show typical sample downloads and a sample queue. The Settings and confirmation screenshots show the same local fixture workflows.

- [Downloads](downloads.png)
- [Queue schedule](queue.png)
- [Download confirmation](confirmation.png)
- [Settings](settings.png)

The [build instructions](../../README.md#rebuild-from-source) are included in the Firefox source ZIP. Submit the Chrome ZIP to Chrome Web Store and the Firefox ZIP and its matching source ZIP to AMO. Use the build ZIPs from the same revision. Provide a public URL for the privacy notice and the publisher's support details when setting up the listings. [Chrome image specifications](https://developer.chrome.com/docs/webstore/images), [Mozilla source submission](https://extensionworkshop.com/documentation/publish/source-code-submission/)

Reviewer walkthrough. Start `ario_daemon` with `aria2c` available, test the default connection in Settings, and add a public HTTPS download. With a protocol-1 daemon, try the link menu and click a directly downloadable HTTP(S) link to verify capture on a fresh install. Choose **Keep in browser** on a second capture to verify that the original resumes. Turn off **Capture browser downloads** in Settings and verify subsequent downloads stay in the browser. For an older management-compatible daemon, verify that downloads and queues work and Settings shows upgrade guidance for capture.

## Smoke checks

The CI matrix runs the browser HTTP fixture on Linux, macOS, and Windows with stable Chrome for Testing and Firefox. See [implementation status](../IMPLEMENTATION_STATUS.md#phase-9--cross-browser-verification-and-release-preparation) for completed coverage.

Build both packages before running the following commands. Live checks on Linux create and remove a temporary daemon database, an isolated aria2 RPC port, browser profiles, and downloaded test files. Use an absolute path to a local `ario_daemon` binary built from the revision under test. Run once for `da9ef00` and once for `640cc1c` with `aria2c` on PATH.

```sh
CHROME_PATH=/path/to/chrome ARIO_DAEMON_BIN=/path/to/ario_daemon pnpm smoke:chrome
FIREFOX_PATH=/path/to/firefox ARIO_DAEMON_BIN=/path/to/ario_daemon pnpm smoke:firefox
python3 tests/browser/packages.py
```

Use `GECKODRIVER_PATH` if Selenium Manager cannot locate or install geckodriver. Omit `ARIO_DAEMON_BIN` to run the fixture checks. `ARIO_TEST_ORIGIN` still connects the smoke tests to an externally managed daemon for read-only checks.
