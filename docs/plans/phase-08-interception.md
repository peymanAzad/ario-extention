# Phase 8 — Browser interception and configurable defaults

## Fresh-session brief

Work in `/home/asana/Documents/ChatGPT/ario-extention`. Requires Phase 7. Read [shared requirements](README.md), the handoff documents, and [the design](../design/ario-design.html), especially Download capture and Settings. Their controls must drive real behavior.

## Implementation

- Add explicit setup/settings enablement after connection. Request downloads, nonblocking request-observation, and required host permissions when enabling interception.
- Use browser adapters and observed metadata to identify reproducible HTTP(S) GET downloads. Leave POST/body-backed, blob/data URLs, private, dangerous, completed, and ambiguous requests in the browser.
- Pause eligible downloads before confirmation. If pause fails, leave the download in the browser.
- Reuse queue/override/start-mode confirmation and “Don't show me again.” Save suppression only after successful submission; it changes future behavior, not the current form choices.
- Automatic capture uses configured defaults: initially Main Queue (ID 1), inherited settings, Start now. If the saved queue is missing, require confirmation instead of silently choosing another.
- Settings edit enablement, confirmation, default queue/overrides, and optional session handoff. The prototype's defaults are visual examples; follow this plan for actual defaults.

## Handoff and recovery

- Stage in Ario while the original is paused; after durable staging, cancel the original, then commit Ario's handoff.
- If cancellation fails, abort staging and leave downloading to the browser. If commit response is lost, query status and retry idempotently.
- Canceling/closing confirmation resumes the original. If resume fails, retain its browser-history record and show recovery guidance.
- Persist non-sensitive state and reconcile unfinished handoffs on background/browser restart. Prevent fallback-download capture loops.
- Keep browser-history entries; automatic cleanup is deferred. If opening a confirmation window fails, badge the extension and expose the pending confirmation from the popup.
- Disabling interception restores unsubmitted paused downloads and finishes reconciling accepted handoffs.
- This is takeover after browser download creation, not a zero-browser-bytes guarantee.

## Acceptance

Test ask/automatic modes, suppression and settings edits, fallback, denied/revoked permissions, unsupported methods/schemes, redirects/signed URLs, cookies, missing queues, daemon outages, duplicate events, concurrent transfers, and interruption at every handoff boundary in both browsers. Update handoff documents.
