import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { fakeBrowser } from '@webext-core/fake-browser';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { daemonHandlers } from './fixtures/daemon';

vi.stubGlobal('browser', fakeBrowser);
vi.stubGlobal('chrome', fakeBrowser);
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

export const server = setupServer(...daemonHandlers);

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  fakeBrowser.reset();
  server.resetHandlers();
});
afterAll(() => server.close());
