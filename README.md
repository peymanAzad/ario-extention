# Ario browser extension

Manage downloads and queues in a local Ario daemon from desktop Chrome or Firefox. The toolbar popup shows live progress, lets you paste links or load torrent files, and gives you access to queue schedules and download settings.

## Set up Ario

1. Install [Ario and aria2](https://github.com/peymanAzad/ario#installation). Start Ario from its TUI, or run `ario_daemon` with `aria2c` on your PATH. The default address is `http://127.0.0.1:47812`.
2. Load the browser package as described below. Open the Ario toolbar popup, select **Open settings**, and test the daemon connection. If you use a different address, enter an HTTP address on `127.0.0.1`, `localhost`, or `[::1]` and select **Save address**.
3. Use **Add download** to paste HTTP(S) or magnet URLs or pick a local `.torrent` file. To send a supported link directly from a page, right-click it and select **Download with Ario**.
4. Ario captures eligible browser downloads by default and asks where to send them. The browser requests the access needed for capture at installation. To keep downloads in the browser, turn off **Capture browser downloads** in Settings. See [capture limitations and permissions](docs/release/STORE.md).

Management was verified with the Ario 0.2.4 API at commit `da9ef00`. Browser link handoff and interception require the daemon's version 1 browser handoff API. Use a daemon built from `640cc1c` or a later compatible revision. Both revisions report Ario 0.2.4, so check for browser handoff support in extension Settings. Ario keeps downloading when you close the extension.

Updates preserve saved capture preferences. Your browser may ask you to approve the added permissions when updating from an earlier build.

## Load a release package locally

- **Chrome.** Extract `ario-extension-0.1.0-chrome.zip`. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted directory containing `manifest.json`.
- **Firefox.** Open `about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on**, and choose `ario-extension-0.1.0-firefox.zip`. The temporary installation lasts until Firefox exits. Regular distribution requires Mozilla signing.

## Rebuild from source

Release build environment was Fedora Linux x86-64, Node.js **24.22.3**, and pnpm **10.30.0**. Install [Node.js 24.22.3](https://nodejs.org/en/blog/release/v24.22.3/) and [pnpm 10.30.0](https://pnpm.io/installation). The commands run from the repository or the extracted Firefox source ZIP:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm zip
```

Use `pnpm zip:firefox` for Firefox only. WXT, Vite, and all package versions resolve through the included lockfile. The first install needs access to the public package registry. Building requires no daemon, browser, credentials, signing keys, or external build service.

The outputs under `.output/` are `ario-extension-0.1.0-chrome.zip`, `ario-extension-0.1.0-firefox.zip`, and `ario-extension-0.1.0-firefox-sources.zip`. The unpacked extension files are under `.output/chrome-mv3/` and `.output/firefox-mv3/`. To compare two builds, compare the files inside the ZIPs independently of archive metadata.

See [Privacy](docs/release/PRIVACY.md) and [Verification and store materials](docs/release/STORE.md).
