import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createBackgroundHandler } from '@/shared/browser/background';

export default defineBackground(() => {
  const onMessage = createBackgroundHandler();
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const reply = onMessage(message, sender);
    if (!reply) return false;

    void reply.then(sendResponse);
    return true;
  });
});
