import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { fakeBrowser } from '@webext-core/fake-browser';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { SettingsProvider } from '@/features/settings/settings-provider';
import { createBackgroundHandler } from '@/shared/browser/background';

export function connectTestBackground() {
  const handler = createBackgroundHandler();
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation(
    async (message: unknown) =>
      handler(message, {
        id: fakeBrowser.runtime.id,
        url: fakeBrowser.runtime.getURL('/options.html'),
        frameId: 0,
      }),
  );
}

export function renderPage(page: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={client}>
      <SettingsProvider>{page}</SettingsProvider>
    </QueryClientProvider>,
  );
}
