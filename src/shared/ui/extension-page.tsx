import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@/features/appearance/theme-provider';
import '@fontsource-variable/inter';
import './theme.css';

export function mountExtensionPage(page: ReactNode) {
  const root = document.getElementById('root');
  if (!root) throw new Error('Extension page is missing its root element.');

  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });

  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>{page}</ThemeProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
