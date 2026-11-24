import { z } from 'zod';
import { mediaLimit, mediaUrl } from './links';
export { mediaLimit, mediaUrl } from './links';

const sourceSchema = z.strictObject({
  url: z
    .string()
    .max(8192)
    .transform((raw, context) => {
      const url = mediaUrl(raw);
      if (url) return url;
      context.addIssue({
        code: 'custom',
        message: 'Expected an HTTP media URL.',
      });
      return z.NEVER;
    }),
  kind: z.enum(['video', 'audio']),
});

export type MediaSource = z.output<typeof sourceSchema>;
export type DetectedMedia = MediaSource & { id: string };

export const mediaPageMessageSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    operation: z.literal('media.report'),
    document: z.string().regex(/^[a-f0-9]{32}$/),
    sources: z.array(sourceSchema).max(mediaLimit),
  }),
  z.strictObject({
    operation: z.literal('media.playerOpen'),
    document: z.string().regex(/^[a-f0-9]{32}$/),
    id: z.uuid(),
  }),
]);
export type MediaPageMessage = z.input<typeof mediaPageMessageSchema>;

const directExtension =
  /\.(?:mp4|m4v|webm|ogv|mov|mp3|m4a|aac|flac|oga|ogg|opus|wav|weba)$/i;
const streamExtension = /\.(?:m3u8?|mpd|mp4s|m4s|cmfa|cmfv|ts|m2ts|ism[lv]?)$/i;
const directType =
  /^(?:video\/(?:mp4|webm|ogg|quicktime|x-m4v)|audio\/(?:mp4|mpeg|webm|aac|flac|x-flac|ogg|opus|wav|wave|x-wav|vnd\.wave|x-m4a)|application\/ogg)$/;
const streamType = /(?:mpegurl|dash\+xml|mp2t|iso\.segment|smoothstreaming)/;

export function isDirectMedia(
  url: string,
  contentType?: string,
  finalUrl = url,
) {
  const path = new URL(url).pathname;
  const finalPath = new URL(finalUrl).pathname;
  const type = contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (
    streamExtension.test(path) ||
    streamExtension.test(finalPath) ||
    streamType.test(type)
  )
    return false;
  return (
    directType.test(type) ||
    ((!type || type === 'application/octet-stream') &&
      (directExtension.test(path) || directExtension.test(finalPath)))
  );
}

export function mediaFileName(url: URL) {
  const name = url.pathname.split('/').filter(Boolean).at(-1);
  if (!name) return url.hostname;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
