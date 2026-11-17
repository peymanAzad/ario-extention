# Phase 1 — Project infrastructure

## Fresh-session brief

Work in `/home/asana/Documents/ChatGPT/ario-extention`. Read [shared requirements](README.md) and [the interactive design](../design/ario-design.html). Inspect `/home/asana/projects/ario` for API/TUI context without modifying it. This phase has no implementation prerequisites.

## Implementation

- Scaffold WXT with React and strict TypeScript. Add Tailwind, shadcn/ui, TanStack Query, React Hook Form, Zod, and Lucide.
- Use pnpm with a committed lockfile and pinned package-manager version; document a supported Node LTS version.
- Create popup, options, background, and placeholder confirmation-window entrypoints. Separate shared UI, types, API transport, browser adapters, storage, and feature modules.
- Establish the design's compact sidebar, restrained mint accent, shared theme tokens, and System/Light/Dark provider. Match the popup proportions and internal scrolling. Use the design for appearance, not simulated functionality or hardcoded sample content.
- Add ESLint, formatting checks, Vitest, React Testing Library, MSW fixtures, and a browser smoke-test harness.
- Add development, type-check, lint, test, browser-specific MV3 build, and ZIP scripts. CI runs checks and builds Chrome and Firefox.
- Begin with storage and loopback host access. Add browser-integration permissions only when used in later phases.
- Create `docs/PROJECT_CONTEXT.md` with architecture, commands, browser targets, repository locations, design reference, and daemon baseline.
- Create `docs/FEATURE_PARITY.md` mapping TUI features to API operations and phases, including native exclusions.
- Create `docs/IMPLEMENTATION_STATUS.md` with phase status, evidence, limitations, and next-session instructions. Preserve the phase plans and design reference.

## Acceptance

Both browser builds load. Popup/options placeholders render in light/dark themes. Type checking, linting, and meaningful render/storage checks pass. Production UI does not display fabricated downloads. Record completed checks and remaining work in the handoff documents.
