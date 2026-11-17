# Ario extension implementation status

## Phase 1 — Infrastructure

Implemented and verified on November 18, 2026. The WXT scaffold has React, strict TypeScript, shared Tailwind and shadcn/ui styling, and separate MV3 targets for Chrome and Firefox. The popup, options, background, and confirmation entrypoints are in place. System is the default theme. Explicit Light and Dark selections persist locally and update open views. The popup and confirmation contain only the Phase 1 shell.

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

### Scope and next session

Phases 2–9 are pending. Begin with [Phase 2 — Daemon connection and typed client](plans/phase-02-connection.md), [project context](PROJECT_CONTEXT.md), and the [feature parity map](FEATURE_PARITY.md).

Recheck the daemon source and serialized request and response types. Add the loopback connection, validated endpoint settings, named background operations for extension UI, and MSW coverage for daemon and aria2 failures. Carry the existing appearance preference forward when adding the versioned settings model.
