# Phase 7 — Context menu and confirmation window

## Fresh-session brief

Work in `/home/asana/Documents/ChatGPT/ario-extention`. Requires Phase 6. Read [shared requirements](README.md), the handoff documents, and [the design](../design/ario-design.html). Use the Download capture screen for the standalone confirmation window.

## Implementation

- Add “Download with Ario” for HTTP(S)/magnet links. Always show confirmation for context-menu actions; interception suppression does not affect them.
- Show URL/file information, queue, inherited settings, overrides, Start now, and Save for later. Reuse shared forms/themes and the reference design's layout.
- Stage/commit submission through the new API. Closing an unsubmitted window discards its draft without creating a download.
- Background-manage active confirmations and reconcile after restart. Window URLs contain opaque IDs, never download URLs or session credentials.
- Add optional session handoff, initially disabled. Request cookies and relevant host permissions through a user action.
- Identify the correct URL, cookie store, and partition where supported. If session context cannot be identified reliably, offer public-link submission or returning to the browser.
- Show upgrade guidance if the daemon lacks browser capabilities.

## Acceptance

Test public URLs, magnets, authenticated links, denied permissions, concurrent windows, close/cancel, restart, duplicate clicks, and unavailable/old daemons. Check Chrome/Firefox and both themes. Update handoff documents.
