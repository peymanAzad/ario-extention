import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsProvider } from '@/features/settings/settings-provider';
import '@fontsource-variable/inter';
import './theme.css';

export function mountExtensionPage(page: ReactNode) {
  const root = document.getElementById('root');
  if (!root) throw new Error('Extension page is missing its root element.');

  const queryClient = new QueryClient({
    defaultOptions: {
      // Loopback requests can work when the browser reports it is offline.
      queries: { networkMode: 'always' },
      mutations: { networkMode: 'always', retry: false },
    },
  });

  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>{page}</SettingsProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
