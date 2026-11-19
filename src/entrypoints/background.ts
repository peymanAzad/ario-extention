import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createBackgroundHandler } from '@/shared/browser/background';
import { createCapture } from '@/shared/browser/capture';
import { createConfirmations } from '@/shared/browser/confirmations';

export default defineBackground(() => {
  const confirmations = createConfirmations();
  const capture = createCapture();
  const onMessage = createBackgroundHandler(confirmations, capture);
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const reply = onMessage(message, sender);
    if (!reply) return false;

    void reply.then(sendResponse);
    return true;
  });
  confirmations.register();
  capture.register();
});
