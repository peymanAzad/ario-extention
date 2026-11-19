import { z } from 'zod';

export const categories = [
  'Video',
  'Music',
  'Document',
  'Archive',
  'Program',
  'Other',
] as const;
export const statuses = [
  'Pending',
  'Active',
  'Paused',
  'Completed',
  'Error',
  'Removed',
] as const;

// UI state lives separately from durable extension preferences and daemon data.
export const dashboardFiltersSchema = z.object({
  queueId: z.int().nullable().default(null),
  category: z.enum(categories).nullable().default(null),
  status: z.enum(statuses).nullable().default(null),
  search: z.string().max(2000).default(''),
  sortBy: z
    .enum(['Name', 'Size', 'CreatedAt', 'QueuePosition'])
    .default('CreatedAt'),
  descending: z.boolean().default(true),
});
export type DashboardFilters = z.infer<typeof dashboardFiltersSchema>;
export const defaultDashboardFilters = dashboardFiltersSchema.parse({});
