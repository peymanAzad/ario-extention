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

Phases 3–9 are pending. Capture preferences are stored with capture disabled, confirmation enabled, Main Queue, inherited settings, immediate start, and session sharing disabled. Capture behavior and controls are scheduled for later phases. The download popup reports the connection state. Queue and download schemas are available for the dashboard.

Begin with [Phase 3 — Download dashboard](plans/phase-03-dashboard.md), [project context](PROJECT_CONTEXT.md), and the [feature parity map](FEATURE_PARITY.md).
