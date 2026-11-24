import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createBackgroundHandler } from '@/shared/browser/background';
import { createCapture } from '@/shared/browser/capture';
import { createConfirmations } from '@/shared/browser/confirmations';
import { createMedia } from '@/shared/browser/media';

export default defineBackground(() => {
  const confirmations = createConfirmations();
  const capture = createCapture();
  const media = createMedia(confirmations.openMedia);
  const onMessage = createBackgroundHandler(confirmations, capture, media);
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const reply = onMessage(message, sender);
    if (!reply) return false;

    void reply.then(sendResponse);
    return true;
  });
  confirmations.register();
  capture.register();
  media.register();
});
