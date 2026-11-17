# Phase 4 — Download creation and management

## Fresh-session brief

Work in `/home/asana/Documents/ChatGPT/ario-extention`. Requires Phase 3. Read [shared requirements](README.md), the handoff documents, and [the design](../design/ario-design.html), including Add download and row actions. Use existing daemon endpoints from `/home/asana/projects/ario`.

## Implementation

- Add single/batch HTTP(S) URLs and magnets, including extraction from pasted mixed text, entry selection, queue choice, and fine-tuning overrides.
- Provide Start now and Save for later. Upload `.torrent` files using the existing multipart endpoint and its 16 MiB file limit.
- Implement Start/Pause/Resume/Retry/Restart according to TUI status semantics. Add details, copy URL/path, queue reassignment, and per-download settings.
- Expose connections per download/server, allocation strategy, piece selector, retries, and retry delay. Preserve inherited/null values and explicit zeros.
- Support removing records while retaining files, confirmed deletion including files, and clearing completed records for a queue or globally.
- Invalidate affected queries after mutations and prevent repeated submission. Submit batch entries individually so failures/successes are identifiable without blindly retrying a partially completed batch.
- Preserve non-sensitive drafts across popup closure. A selected torrent may need to be selected again. Extend the reference design consistently for workflows it does not illustrate.

## Acceptance

Exercise HTTP/magnet/torrent inputs, inherited values, zero retries, partial batch failure, action transitions, queue moves, deletion modes, and concurrent changes from the TUI. Verify the design's row actions reflect real server state. Update handoff documents.
