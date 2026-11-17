# Phase 6 — Daemon support for reliable browser handoff

## Fresh-session brief

Open `/home/asana/projects/ario` as the working repository with access to `/home/asana/Documents/ChatGPT/ario-extention`. Requires Phase 5. Read the extension's `docs/plans/README.md` and handoff documents. [The design](../design/ario-design.html) supplies capture/settings context; this phase changes backend capabilities, not the prototype.

## Implementation

- Add capabilities reporting: browser protocol version, handoff support, and daemon timezone.
- Implement staged, idempotent handoff. Browser downloads remain available until requests are durably accepted. Staged handoffs are outside ordinary scheduling.
- Support suggested filename, queue, fine-tuning, and optional narrowly defined HTTP session context: applicable cookies, referrer, user agent. Validate methods/URLs, header values, and filenames.
- Keep session context private: omit it from download lists, diagnostics, and logs; purge it when its associated download is deleted. Apply it to transfers/retries.
- Prevent cross-origin credential forwarding. Initially disable further HTTP redirects for credential-bearing transfers and use the browser-observed final URL.
- Restrict handoff endpoints to extension-origin JSON requests; retain originless local-client compatibility. Replace permissive browser CORS with extension-origin handling while keeping TUI behavior compatible.
- Add persistence/migrations using existing daemon conventions and enough state to recover after restart.
- Extend the extension client with capability checks and daemon timezone. Existing management remains usable against older daemons.

## API contract

- `GET /browser-capabilities`: version, supported capabilities, daemon timezone.
- `POST /browser-handoffs`: validate/stage under a client UUID. Replaying identical UUID/payload returns the original handoff; conflicting reuse fails.
- `GET /browser-handoffs/{id}`: reconcile staged/committed/aborted state.
- `POST /browser-handoffs/{id}/commit`: atomically create one download and record its ID. Repeated calls return that result without restarting it. The selected start mode and queue capacity control eligibility.
- `POST /browser-handoffs/{id}/abort`: discard an uncommitted handoff.

## Acceptance

Test duplicate staging/commit, conflicting reuse, restart recovery, abort, deleted queues, private context, filenames, credential redirects, and migration from the existing database. Run Rust formatting, Clippy, and existing tests including TUI regressions. Record API contracts/fixtures in extension handoff documents.
