# Phase 2 — Daemon connection, typed client, and settings

## Fresh-session brief

Work in `/home/asana/Documents/ChatGPT/ario-extention`. Requires Phase 1. Read [shared requirements](README.md), the project context/parity/status documents, and [the design](../design/ario-design.html), particularly Settings. Inspect the real API at `/home/asana/projects/ario`.

## Implementation

- Model actual JSON contracts: serialized Rust enums, nullable fine-tuning fields, schedules, health, and live download status. Distinguish JSON success, empty success, and structured errors.
- Add fetch transport with timeouts, cancellation, and useful errors. Use typed background messages with named operations; accept only trusted extension UI and never expose arbitrary fetch URLs.
- Share Query keys/hooks, while treating popup/options/confirmation caches as independent. Disable automatic retries for mutations that could duplicate work.
- Build connection settings, connection test, reconnect, and distinct daemon-unavailable/aria2-unreachable states using the design's Settings layout.
- Validate loopback HTTP addresses and configurable ports. Persist versioned settings locally and propagate changes to open views.
- Include theme and future capture preferences in the settings model. Define shared `ExtensionSettings`, connection, error, and background-message types.
- Display daemon category locations and proxy configuration/status as read-only information where supported. Do not add daemon configuration writes.

## Acceptance

Test connection success/refusal, timeout, malformed responses, aria2 failure, persistence, message-sender validation, and rejection of non-loopback URLs. Verify real requests from Chrome and Firefox. No daemon changes are needed. Update handoff documents.
