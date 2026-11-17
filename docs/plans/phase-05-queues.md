# Phase 5 — Full queue configuration and HTTP parity

## Fresh-session brief

Work in `/home/asana/Documents/ChatGPT/ario-extention`. Requires Phase 4. Read [shared requirements](README.md), the handoff documents, and [the design](../design/ario-design.html). Its Queue editor is the visual reference; daemon/TUI source defines behavior.

## Implementation

- Build queue create/edit with General, Schedule, Events, and Download Items sections. Include name, concurrency, retries/delay, and all queue fine-tuning defaults.
- Match TUI creation defaults: concurrency 1, retries 3, retry delay 5 seconds, inherited fine-tuning, scheduling disabled. Do not substitute sample prototype values.
- Support one-time/daily/weekly/overnight windows; daily uses all weekdays. Convert one-time local datetime inputs to UTC. Label weekly times as following the daemon machine's timezone.
- Expose schedule enablement, missed-startup behavior, and scheduled stop. Use capability-provided daemon timezone once available in Phase 6; do not invent it for older daemons.
- Add success/automatic-stop commands and latest results: timestamps, exit codes, failures, interrupted states. Explain that commands run on the daemon computer. Clear commands using explicit empty-string API behavior.
- Stage download ordering locally and persist on Save. Report partial success if settings save but reordering fails.
- Add queue start/pause, deletion, and nonempty confirmation. Protect Main Queue and virtual All Queues; handle “nothing to start.”
- Finish the parity inventory, retaining the agreed exclusions for native actions, daemon shutdown, and configuration writes.

## Acceptance

Test create/edit round trips, validation, overnight and daylight-saving boundaries, command clearing/results, reordering, Cancel, nonempty deletion, and empty resume. Verify both themes and bounded popup scrolling. Update handoff documents.
