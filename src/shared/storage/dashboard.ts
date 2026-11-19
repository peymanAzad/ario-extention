import { browser } from 'wxt/browser';
import {
  dashboardFiltersSchema,
  defaultDashboardFilters,
  type DashboardFilters,
} from '@/shared/types/dashboard';

const key = 'dashboardFilters';

export async function readDashboardFilters(): Promise<DashboardFilters> {
  const values = await browser.storage.local.get(key);
  return (
    dashboardFiltersSchema.safeParse(values[key]).data ??
    defaultDashboardFilters
  );
}

// Called by the background so pending writes survive popup closure.
// Serialize rapid input changes so the final keystroke wins on the next opening.
let pending: Promise<void> = Promise.resolve();
export function writeDashboardFilters(
  filters: DashboardFilters,
): Promise<DashboardFilters> {
  const next = pending
    .catch(() => {})
    .then(() => browser.storage.local.set({ [key]: filters }));
  pending = next;
  return next.then(() => filters);
}
