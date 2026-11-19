# Ario extension implementation status

## Phase 1 — Infrastructure

Implemented and verified on November 18, 2026. The WXT scaffold has React, strict TypeScript, shared Tailwind and shadcn/ui styling, and separate MV3 targets for Chrome and Firefox. The popup, options, background, and confirmation entrypoints are in place. System is the default theme. Explicit Light and Dark selections persist locally and update open views. Phase 1 delivered placeholder popup and confirmation shells.

### Verification

| Check                                              | Result                                                                                                                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js 24.22.3 and pnpm 10.30.0                   | Frozen install succeeded with `pnpm-lock.yaml`                                                                                                                                              |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | Passed                                                                                                                                                                                      |
| `pnpm test`                                        | Five tests passed across storage defaults and change events, theme persistence, and popup rendering and Settings launch                                                                     |
| `pnpm build` and `pnpm zip`                        | Built and packaged both MV3 targets in `.output/`                                                                                                                                           |
| `pnpm smoke:chrome` with Chrome 157.0.8103.78      | Loaded the unpacked extension, measured the 780 × 580 toolbar popup, and verified the adaptive layout, OS theme, theme persistence and propagation, Settings launch, and confirmation shell |
| `pnpm smoke:firefox` with Firefox 160.0            | Loaded the ZIP as a temporary add-on and verified the popup, Settings launch, persistent Light and Dark colors across views, and confirmation shell                                         |

The CI workflow runs the checks, packages both targets, and runs both browser smoke tests. The commands passed locally. GitHub Actions has yet to run for this checkout.

## Phase 2 — Daemon connection, typed client, and settings

Implemented on November 18, 2026 against daemon commit `da9ef00e5abe5a0df3baa526a6ce2a6b4e2e090f`. Settings can test a draft loopback HTTP address, save it across open views, and reconnect to the saved address. The popup and Settings distinguish daemon unavailability from aria2 unreachability. Settings displays the daemon’s download locations, proxy configuration and status, and available aria2 defaults as read-only information.

The background accepts named health, settings, and cancellation messages from trusted extension pages. The client validates Rust JSON contracts, rejects redirects, and reports transport, HTTP, timeout, cancellation, and response failures. Versioned local settings carry forward the Phase 1 theme and store the defaults for future capture behavior.

### Verification

| Check                                                                  | Result                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `git diff --check` | Passed                                                                                                                                                                                                                                             |
| `pnpm test`                                                            | 33 tests passed, covering connection success and refusal, timeout and cancellation, malformed and structured replies, aria2 failure and reconnect, loopback validation, trusted senders, storage migration and concurrent writes, and wire schemas |
| `pnpm zip`                                                             | Built and packaged Chrome and Firefox MV3 targets                                                                                                                                                                                                  |
| `pnpm smoke:chrome` and `pnpm smoke:firefox`                           | Passed with the loopback HTTP fixture and with a temporary Ario daemon and aria2. Chrome 157 and Firefox 160 read health and settings over `127.0.0.1`, `localhost`, and `[::1]` on ephemeral ports.                                               |
| Settings layout                                                        | Inspected in light and dark themes at desktop and narrow widths                                                                                                                                                                                    |

### Scope and next session

At the end of Phase 2, Phases 3–9 were pending. Capture preferences are stored with capture disabled, confirmation enabled, Main Queue, inherited settings, immediate start, and session sharing disabled. Capture behavior and controls are scheduled for later phases. The download popup reports the connection state. Queue and download schemas are available for the dashboard.

Phase 2 handed off to [Phase 3 — Download dashboard](plans/phase-03-dashboard.md), [project context](PROJECT_CONTEXT.md), and the [feature parity map](FEATURE_PARITY.md).

## Phase 3 — Download dashboard

Implemented on November 19, 2026. Rechecked download, queue, filter/sort, live-progress, and health contracts against the unchanged daemon commit `da9ef00e5abe5a0df3baa526a6ce2a6b4e2e090f`. This phase adds read-only `daemon.downloads` and `daemon.queues` messages. Production data comes only from the daemon; sample downloads remain in test fixtures.

The popup follows the reference’s sidebar, mint accent, compact file rows, progress tracks, and footer in both themes. It offers All Queues and individual active/paused queues; all six categories and status variants; combined case-insensitive filename/URL search; and name, size, creation-time, and queue-position sorting in both directions. Filters, search, and sort survive reopening. A deleted queue selection resets to All Queues after a successful queue load. Unknown sizes/ETA, torrent metadata acquisition, download error messages, aggregate speed, active count, connection state, and optional proxy health are displayed.

Health, downloads, and queues refresh every second while visible. During outages, each query retains its last successful response, the popup labels the view as last known, and Reconnect retries all three resources. Origin-specific caches prevent data from the old daemon appearing under a newly saved address. Fixed-height virtualization bounds rendered rows; keyboard users can Tab through navigation and controls and scroll the list with Arrow/Page/Home/End keys. Progress has accessible labels and values.

### Verification

| Check                                                                  | Result                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js 24.22.3 and pnpm 10.30.0                                       | Used for final type checking, tests, packaging, and browser checks                                                                                                                                                                                                                                                            |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `git diff --check` | Passed                                                                                                                                                                                                                                                                                                                        |
| `pnpm test`                                                            | 63 tests passed, including all wire statuses, combined queue/category/status/search, both directions of all sorts, missing/deleted queues, loading/empty/failure states, reconnect, origin isolation, visibility/unmount polling, persistence after closure, proxy variants, keyboard controls, and 10,000-row virtualization |
| `pnpm zip`                                                             | Built and packaged both Chrome and Firefox MV3 targets                                                                                                                                                                                                                                                                        |
| `pnpm smoke:chrome`                                                    | Passed in Chrome 157.0.8103.78: real 780 × 580 toolbar popup, loopback reads, combined filters and remembered search, determinate/unknown progress, outage/reconnect, 10,000 rows, Home/End navigation, scripted visibility suspension, and narrow overflow                                                                   |
| `pnpm smoke:firefox`                                                   | Passed in Firefox 160.0: installed MV3 ZIP, loopback reads, status/queue/URL search, remembered search after reload, outage/reconnect, 10,000 rows, Home/End navigation, and narrow overflow                                                                                                                                  |
| Visual QA                                                              | Inspected Chrome and Firefox light/dark layouts, Chrome outage view, and narrow layouts. Screenshots are generated under ignored `test-results/dashboard-*.png`.                                                                                                                                                              |

### Limitations and next session

- Browser checks used an isolated HTTP fixture with actual extension-to-background-to-loopback requests. Phase 3 did not launch or modify a real daemon; Phase 2’s real-daemon evidence remains recorded above.
- Last successful server data is retained within the open UI’s Query cache, not persisted after the popup closes. Only dashboard UI preferences persist. Large lists still require the daemon’s complete unpaginated snapshot; virtualization bounds DOM rendering, not network payload or local filtering work.
- Headless Chrome reports background tabs as visible, so its harness dispatches explicit visibility changes. Render tests independently verify polling pauses when hidden, resumes when visible, and stops on unmount.
- Proxy fields omitted by the daemon show “not reported”; no proxy-enabled assumption is made. Metadata acquisition is inferred from a torrent/magnet without a known positive total because the current API has no explicit metadata flag.
- At the end of Phase 3, Phases 4–9 remained pending. Adding downloads, row actions/details, queue editing, and browser capture were outside that read-only phase. No new browser permissions were added. The plan documents and design reference are preserved.

Phase 3 handed off to [Phase 4 — Download workflows](plans/phase-04-downloads.md), [project context](PROJECT_CONTEXT.md), and the [feature parity map](FEATURE_PARITY.md).

## Phase 4 — Download workflows

Implemented on November 19, 2026 against the unchanged daemon commit `da9ef00e5abe5a0df3baa526a6ce2a6b4e2e090f`. The popup adds an Add downloads dialog for selected links extracted from mixed pasted text, HTTP(S) URLs, magnet links, and local torrent files up to 16 MiB. Users can choose a queue, keep or customize its defaults, and select Start now or Save for later. Each link gets an individual outcome. Already-added entries are locked in the batch and rejected entries require explicit reselection.

Status-based row controls provide Start, Pause, Resume, Retry, and Restart. Download details provides copyable URL and destination folder, queue reassignment, and per-download settings. Record removal keeps files. File deletion requires confirmation and reports removed or missing files and incomplete metadata when reported by the daemon. Clear completed confirms the scope and works for the selected queue or all queues. The dialogs use the reference’s compact form layout and existing light/dark theme tokens.

The background uses named, validated operations. Open views refresh affected queries after writes. Actions and edits compare their expected state with current daemon details before writing. A final race remains because the daemon offers no conditional mutation endpoint. The selected queue and valid override settings survive popup closure. Pasted links and selected torrent files are transient. Closing the popup can leave the rest of a batch unsubmitted.

### Verification

- Type checking, lint, formatting, and whitespace checks passed. All 70 Vitest tests passed.
- Download workflow tests use daemon-shaped HTTP responses and mock state changes from the TUI. They cover mixed links and magnets, partial and uncertain outcomes, repeated submission, both start modes, inherited and zero values, a 16 MiB multipart file and oversize validation, status transitions, stale edits, clipboard actions, queue reassignment, both deletion modes, and both clear scopes.
- Chrome and Firefox MV3 extensions were built and packaged. The sandbox denies binding to loopback. The automatic approval service returned HTTP 404 for the request to run the browser smoke checks outside the sandbox. Browser layout and live daemon workflows remain unverified for Phase 4.

Continue with [Phase 5 — Queue management and HTTP parity](plans/phase-05-queues.md), [project context](PROJECT_CONTEXT.md), and the [feature parity map](FEATURE_PARITY.md).

## Phase 5 — Queue management and HTTP parity

Implemented on November 19, 2026 against daemon commit `da9ef00e5abe5a0df3baa526a6ce2a6b4e2e090f`. The popup adds queue creation and management and uses the reference’s General, Schedule, Events, and Download Items sections. New queues start with one concurrent download, three retries, a five-second retry delay, inherited fine-tuning, and scheduling disabled.

Schedules support one-time, daily, weekly, and overnight windows, startup catch-up, and the daemon’s current scheduled stop. One-time inputs convert from browser local time to UTC. The editor rejects newly entered times in skipped or repeated daylight-saving hours and preserves existing stored instants. Daily schedules send all seven weekdays. Recurring times use the daemon computer’s local timezone.

The editor configures success and automatic-stop commands, clears them with explicit empty strings, and displays the latest attempts and timestamps. Queue order is staged until Save. If reordering fails after settings are saved, the editor retains the staged order for retry or reset. The manager can start, pause, and delete real queues, reports empty resume, protects Main Queue, and confirms deletion of records from nonempty queues. Downloaded files remain on disk.

### Verification

- Type checking, lint, formatting, and whitespace checks passed. All 79 Vitest tests passed.
- Phase 5 tests cover settings round trips and validation, overnight windows, spring and fall daylight-saving transitions, command clearing and results, staged reorder, partial save and retry, stale configuration and order, Cancel, nonempty deletion, and empty resume. Tests use daemon-shaped HTTP fixtures through the extension background handler.
- Chrome and Firefox MV3 extensions were built and packaged. The browser harnesses include queue editor theme and bounded scrolling checks. The sandbox denied loopback binding, and automatic approval review for running the browser smoke tests returned HTTP 404. The new browser checks and live daemon workflows remain unverified.

Phase 6 will add browser handoff capabilities, including the daemon timezone when provided. Continue with [Phase 6 — Daemon browser handoff](plans/phase-06-daemon-handoff.md), [project context](PROJECT_CONTEXT.md), and the [feature parity map](FEATURE_PARITY.md).
