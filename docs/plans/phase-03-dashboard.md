# Phase 3 — Download dashboard, queues, filters, and search

## Fresh-session brief

Work in `/home/asana/Documents/ChatGPT/ario-extention`. Requires Phase 2. Read [shared requirements](README.md), the handoff documents, and [the design](../design/ario-design.html). Use its Downloads screen as the primary visual reference.

## Implementation

- Provide All Queues and individual queues with active/paused indicators, plus category/status filters and text search.
- Search filename and URL case-insensitively within the selected queue/category/status results. Support sorting by name, size, creation time, and queue position in both directions.
- Match the design's sidebar, header, compact file rows, progress tracks, and footer. Show filename/URL fallback, status, transferred/total size, speed, ETA, and queue.
- Handle unknown sizes/ETA, torrent metadata acquisition, and daemon errors. Show aggregate speed, active count, connection, and proxy status.
- Poll downloads, queues, and health every second while relevant UI is visible; stop polling when closed. Retain last successful data with a stale indicator during outages.
- Remember filters/search across popup openings; reset a missing queue selection to All Queues. Virtualize long lists.

## Acceptance

Verify all status variants, combined filters, sorting, empty/loading/error states, reconnect, large lists, keyboard access, and readable progress. Check both browsers/themes and popup overflow. This phase is read-only. Update handoff documents.
