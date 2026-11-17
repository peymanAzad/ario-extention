import { z } from 'zod';

export const appearanceSchema = z.enum(['system', 'light', 'dark']);
export type Appearance = z.infer<typeof appearanceSchema>;
