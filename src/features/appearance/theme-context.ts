import { createContext, useContext } from 'react';
import type { Appearance } from '@/shared/types/appearance';

type ThemeState = {
  appearance: Appearance;
  ready: boolean;
  setAppearance: (appearance: Appearance) => Promise<void>;
};

export const ThemeContext = createContext<ThemeState | null>(null);

export function useTheme(): ThemeState {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('ThemeProvider is required.');
  return theme;
}
