import { storage } from 'wxt/utils/storage';
import { appearanceSchema, type Appearance } from '@/shared/types/appearance';

const preference = storage.defineItem<Appearance>('local:appearance');

function parseAppearance(value: unknown): Appearance {
  const result = appearanceSchema.safeParse(value);
  return result.success ? result.data : 'system';
}

export async function readAppearance(): Promise<Appearance> {
  return parseAppearance(await preference.getValue());
}

export function writeAppearance(value: Appearance): Promise<void> {
  return preference.setValue(value);
}

export function watchAppearance(
  listener: (appearance: Appearance) => void,
): () => void {
  return preference.watch((value) => listener(parseAppearance(value)));
}
