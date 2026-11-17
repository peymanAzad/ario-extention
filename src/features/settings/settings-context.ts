import { createContext, useContext } from 'react';
import type { ExtensionSettings } from '@/shared/types/settings';

type SettingsState = {
  settings: ExtensionSettings;
  ready: boolean;
  loadFailed: boolean;
};

export const SettingsContext = createContext<SettingsState | null>(null);

export function useExtensionSettings(): SettingsState {
  const state = useContext(SettingsContext);
  if (!state) throw new Error('SettingsProvider is required.');
  return state;
}
