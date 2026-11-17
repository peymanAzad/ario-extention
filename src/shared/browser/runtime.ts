import { browser } from 'wxt/browser';

export function openOptions(): Promise<void> {
  return browser.runtime.openOptionsPage();
}
