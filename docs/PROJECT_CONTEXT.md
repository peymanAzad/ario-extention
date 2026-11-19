# Ario extension project context

## Repositories and reference

- The extension workspace is `/home/asana/Documents/ChatGPT/ario-extention`.
- The daemon and terminal UI live in `/home/asana/projects/ario`. Phases 2–5 checked the API against commit `da9ef00e5abe5a0df3baa526a6ce2a6b4e2e090f` without changing the daemon checkout.
- [Implementation plans](plans/README.md) and [visual reference](design/ario-design.html). The reference provides compact navigation, typography, spacing, and theme colors. Product behavior comes from the plans and daemon source.
- Desktop Chrome and Firefox use Manifest V3. WXT generates a Chrome service worker and Firefox background scripts. The toolbar popup targets 780 × 580 CSS pixels and scrolls within its panes. Settings opens in an extension tab. Confirmation is an unlisted extension page for the future standalone window.

## Architecture

| Location              | Responsibility                                                                     |
| --------------------- | ---------------------------------------------------------------------------------- |
| `src/entrypoints/`    | WXT popup, options, confirmation page, and background entrypoint                   |
| `src/features/`       | Dashboard, download and queue workflows, connection status, and extension settings |
| `src/shared/ui/`      | Page bootstrap, theme tokens, header, and controls                                 |
| `src/shared/types/`   | Runtime schemas and TypeScript types for settings, daemon responses, and messages  |
| `src/shared/storage/` | Versioned settings, dashboard filters, download draft settings, and subscriptions  |
| `src/shared/browser/` | Named runtime messages and trusted extension-page validation                       |
| `src/shared/api/`     | Loopback validation, daemon fetch transport, and Query keys and hooks              |
| `tests/`              | Vitest and Testing Library checks, MSW fixtures, and browser smoke scripts         |

Each extension page mounts its own TanStack Query client. Daemon query keys include the saved origin. Queries forward cancellation to the background, and mutation retries are disabled by default. The background serializes settings writes. Open pages observe storage so changes to the endpoint and appearance propagate across views. The first write to the versioned settings record carries forward the Phase 1 appearance preference. System follows the OS through CSS.

The manifest requests `storage` and HTTP host access for `127.0.0.1`, `localhost`, and `[::1]` on any port. Connection Settings defaults to `http://127.0.0.1:47812`. Test connection checks the draft address, Save address applies it across views, and Reconnect checks the saved address. Only the trusted popup, options, and confirmation documents can send named background operations. The background exposes health, settings, download, and queue reads and the download and queue writes listed in the [feature parity map](FEATURE_PARITY.md).

The Phase 3 dashboard polls health, downloads, and queues every second while its document is visible. Closing the popup disposes its Query observers and cancels outstanding requests. Last successful responses remain in the current page’s cache during failures, with an interruption banner, download timestamp, and explicit reconnect. Caches are keyed by daemon origin and are not persisted across popup openings.

The dashboard fetches the complete download snapshot and composes queue/category/status filters, case-insensitive filename/URL search, and all four sorts locally. This handles the payload-bearing Rust `Error(String)` variant as one Failed filter. Unknown sizes sort last in either direction; equal sort keys use the download ID for stability. Queue position sorts by `position_in_queue`, matching the daemon. Category counts reflect the selected queue. Missing selected queues reset to All Queues only after a successful queue snapshot is available.

`dashboardFilters` is a separate local storage record for UI state, outside versioned extension preferences. Named `dashboard.update` messages serialize complete filter saves in the background so pending writes can finish after the popup closes. The download list uses fixed 112-pixel rows with a measured scroll viewport and three rows of overscan on each side. A focusable region supports Arrow, Page, Home, and End keys; list items announce their position and total count. Rows expose labeled progress, including indeterminate progress for unknown totals. Torrent/magnet rows without a known positive size display metadata acquisition state; the daemon has no dedicated metadata-progress flag.

The Add downloads dialog extracts and deduplicates HTTP(S) and magnet URLs from pasted text. Checked links are submitted sequentially, one daemon request per entry. An accepted record is marked added even if its transfer failed. A rejected entry can be explicitly reselected. A timeout, transport failure, or unexpected daemon response leaves the outcome uncertain, so the dialog directs the user to the dashboard before trying again. Imports submitted before popup closure can finish in the daemon. Links still waiting for submission and their in-dialog outcomes are transient. The origin-scoped `downloadDraft` storage record retains the queue and valid fine-tuning choices. Pasted links, filenames, and torrent bytes are transient.

Torrent uploads use a base64 runtime message for cross-browser serialization and are decoded into multipart `metadata` and `file` parts in the background. The extension enforces the daemon’s 16 MiB file limit. Fine-tuning fields serialize blank values as `null` and preserve explicit zeros. The daemon resolves blanks against the current queue defaults and returns effective stored values. Per-download settings apply when the daemon creates a new aria2 transfer for that record.

Row actions follow the TUI status mapping. A pause acknowledged while the daemon still reports Active is displayed as pending until a later snapshot changes. The background reads details immediately before status-dependent actions and before download queue reassignment or fine-tuning edits. Mutations invalidate origin-scoped health, downloads, details, and queues. Clear completed uses the selected queue or all queues, independent of search and category/status filters.

The popup’s Queues sidebar opens the queue manager or a new queue draft. The queue editor polls the queue detail for the current scheduled stop and latest command results. Editable settings and staged download order live in the editor until Save. One-time inputs use the browser’s local timezone and serialize as UTC. Newly entered local times in skipped or repeated daylight-saving hours require a different time. Existing one-time instants retain their exact wire values when their displayed input stays the same. Daily windows use all seven weekdays and recurring windows use the daemon’s local time. The daemon determines recurring daylight-saving transitions and reports the current run’s stop timestamp.

One background operation saves queue settings and then applies staged order. It rereads the current configuration and download order before writes to detect concurrent changes. The endpoints have no atomic preconditions, so a concurrent change can still race between each check and write. A failed reorder leaves saved settings in place and the order staged for retry or reset. Nonempty queue deletion uses the daemon’s conflict response to request confirmation before deleting download records. The daemon keeps downloaded files.

Daemon contracts live in `common/src/`, `server/src/routes/`, `server/src/error.rs`, and `tui/src/api.rs`. The server returns bare JSON for active read routes and an empty body for some write routes. Structured application errors carry `{"result":"error","message":"…"}`. Rust enum variants use their serialized casing, and payload variants like download status `Error(String)` serialize as objects.

## Commands

Use Node.js 24 LTS and pnpm 10.30.0 from `package.json`. With Corepack installed, run `corepack enable`, followed by `pnpm install --frozen-lockfile`.

| Command                                             | Purpose                                                    |
| --------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm dev` / `pnpm dev:firefox`                     | Run WXT development mode in Chrome or Firefox              |
| `pnpm typecheck`                                    | Generate WXT types and run strict TypeScript               |
| `pnpm lint`                                         | Run ESLint                                                 |
| `pnpm format:check` / `pnpm format`                 | Check or apply Prettier formatting                         |
| `pnpm test`                                         | Run unit and render tests                                  |
| `pnpm build`                                        | Produce unpacked MV3 builds for both browsers              |
| `pnpm build:chrome` / `pnpm build:firefox`          | Build a single browser target                              |
| `pnpm zip` / `pnpm zip:chrome` / `pnpm zip:firefox` | Build and package installable bundles under `.output/`     |
| `pnpm smoke:chrome`                                 | Load the Chrome build as an unpacked extension in Chromium |
| `pnpm smoke:firefox`                                | Load the Firefox ZIP as a temporary add-on                 |

For Chromium smoke testing, run `pnpm build:chrome` and `pnpm exec playwright install chromium` first. Set `CHROME_PATH` to use a recent installed Chrome or Chromium instead of Playwright’s browser. For Firefox, install Firefox and run `pnpm zip:firefox`. Selenium Manager locates geckodriver by default. Set `GECKODRIVER_PATH` to use a local executable and `FIREFOX_PATH` if Firefox is outside the usual lookup path. The harnesses use isolated profiles, run headless, and start a loopback HTTP fixture on an ephemeral port. Set `ARIO_TEST_ORIGIN` to the HTTP origin of a running Ario daemon with aria2 available to exercise the same checks against the daemon.

For manual testing, load `.output/chrome-mv3` through Chrome’s **Load unpacked** control. In Firefox, open `about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on**, and choose `.output/firefox-mv3/manifest.json`. Pin the extension or open it from the extensions menu, then use the popup’s Settings button to set the daemon address or change the theme.
