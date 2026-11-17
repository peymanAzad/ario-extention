# Phase 9 — Cross-browser verification and release preparation

## Fresh-session brief

Work in `/home/asana/Documents/ChatGPT/ario-extention`. Requires Phase 8. Read [shared requirements](README.md), the handoff documents, and [the design](../design/ario-design.html). Audit completed UI against that reference and behavior against the current TUI/API.

## Implementation

- Finish feature parity and resolve unintended gaps. Record deliberate native/platform exclusions.
- Verify current stable desktop Chrome/Firefox, with Windows/macOS/Linux smoke coverage. Test an older management-compatible daemon and the handoff-capable daemon.
- Check large lists, rapid progress, accessibility/focus, clipboard actions, drafts/recovery, System/Light/Dark, popup bounds, and confirmation/settings layout.
- Verify production manifests, MV3 background lifecycle, requested permissions, CSP, bundled assets, and no remote executable code. Preserve the standalone reference file and its sandbox/CSP.
- Add release icons/screenshots, setup instructions, daemon requirements, permission explanations, privacy documentation, and capture limitations.
- Produce Chrome/Firefox packages, including Firefox source packaging, and reproducible build instructions.
- Update project context, parity, and status with actual evidence and remaining limitations. Prepare store materials; publishing to browser stores is a separate action.

## Acceptance

All automated checks pass. Real daemon/browser verification demonstrates management, scheduling, context-menu submission, and interception recovery. Both release packages are available; any unverified OS/browser coverage is reported accurately.
