# Ario extension project context

## Repositories and reference

- The extension workspace is `/home/asana/Documents/ChatGPT/ario-extention`.
- The daemon and terminal UI live in `/home/asana/projects/ario`. Phase 1 inspected commit `da9ef00e5abe5a0df3baa526a6ce2a6b4e2e090f` without changing the daemon checkout.
- [Implementation plans](plans/README.md) and [visual reference](design/ario-design.html). The reference provides compact navigation, typography, spacing, and theme colors. Product behavior comes from the plans and daemon source.
- Desktop Chrome and Firefox use Manifest V3. WXT generates a Chrome service worker and Firefox background scripts. The toolbar popup targets 780 × 580 CSS pixels and scrolls within its panes. Settings opens in an extension tab. Confirmation is an unlisted extension page for the future standalone window.

## Architecture

| Location              | Responsibility                                                             |
| --------------------- | -------------------------------------------------------------------------- |
| `src/entrypoints/`    | WXT popup, options, confirmation page, and background entrypoint           |
| `src/features/`       | React popup and confirmation shells, appearance settings and provider      |
| `src/shared/ui/`      | Page bootstrap, shared theme tokens, brand/header, and shadcn-style button |
| `src/shared/types/`   | Shared runtime schemas and TypeScript types                                |
| `src/shared/storage/` | Durable local appearance preference, validation, and change subscription   |
| `src/shared/browser/` | Browser runtime adapter                                                    |
| `src/shared/api/`     | Loopback host declaration and home for the Phase 2 transport               |
| `tests/`              | Vitest and Testing Library checks, MSW fixtures, and browser smoke scripts |

Each extension page mounts an independent TanStack Query client for future server state. Mutations default to zero automatic retries. Browser storage holds the appearance preference. The default System mode follows the OS through CSS. Open views watch storage so explicit Light and Dark choices propagate across pages. React Hook Form is available for later forms.

The manifest requests `storage` and HTTP host access for `127.0.0.1`, `localhost`, and `[::1]` on any port. Phase 2 starts with `http://127.0.0.1:47812` and adds loopback validation, transport, and named background operations. The Phase 1 background entrypoint has no listeners.

Daemon contracts live in `common/src/`, `server/src/routes/`, `server/src/error.rs`, and `tui/src/api.rs`. Successful replies can carry JSON or an empty body. Structured application errors carry `{"result":"error","message":"…"}`. Rust enum variants use their serialized casing, and payload variants like download status `Error(String)` serialize as objects. Recheck the current daemon source before implementing the Phase 2 client.

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

For Chromium smoke testing, run `pnpm build:chrome` and `pnpm exec playwright install chromium` first. Set `CHROME_PATH` to use a recent installed Chrome or Chromium instead of Playwright’s browser. For Firefox, install Firefox and run `pnpm zip:firefox`. Selenium Manager locates geckodriver by default. Set `GECKODRIVER_PATH` to use a local executable and `FIREFOX_PATH` if Firefox is outside the usual lookup path. The harnesses use isolated profiles and run headless.

For manual testing, load `.output/chrome-mv3` through Chrome’s **Load unpacked** control. In Firefox, open `about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on**, and choose `.output/firefox-mv3/manifest.json`. Pin the extension or open it from the extensions menu, then use the popup’s Settings button to change the theme.
