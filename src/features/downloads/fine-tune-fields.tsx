import { fineTuneSchema, type FineTune } from '@/shared/types/daemon';

const numberFields = [
  ['connections_per_download', 'Connections per download'],
  ['max_connections_per_server', 'Connections per server'],
  ['max_retries', 'Maximum retries'],
  ['retry_wait_seconds', 'Retry delay (seconds)'],
] as const;

const allocations = {
  None: 'None',
  Prealloc: 'Preallocate',
  Falloc: 'Fallocate',
  Trunc: 'Truncate',
};
const selectors = {
  Default: 'Default',
  InOrder: 'In order',
  Random: 'Random',
  Geom: 'Geometric',
};

export type FineTuneInput = Record<keyof FineTune, string>;

export function fineTuneInput(fineTune: FineTune): FineTuneInput {
  return {
    connections_per_download: String(fineTune.connections_per_download ?? ''),
    max_connections_per_server: String(
      fineTune.max_connections_per_server ?? '',
    ),
    max_retries: String(fineTune.max_retries ?? ''),
    retry_wait_seconds: String(fineTune.retry_wait_seconds ?? ''),
    alloc_strategy: fineTune.alloc_strategy ?? '',
    stream_piece_selector: fineTune.stream_piece_selector ?? '',
  };
}

export function parseFineTune(input: FineTuneInput) {
  const fields: Record<string, string | number | null> = { ...input };
  for (const [field] of numberFields) {
    const value = input[field].trim();
    fields[field] =
      value === '' ? null : /^\d+$/.test(value) ? Number(value) : NaN;
  }
  fields.alloc_strategy = input.alloc_strategy || null;
  fields.stream_piece_selector = input.stream_piece_selector || null;
  return fineTuneSchema.safeParse(fields);
}

export function FineTuneFields({
  value,
  onChange,
  queueDefaults = false,
}: {
  value: FineTuneInput;
  onChange: (next: FineTuneInput) => void;
  queueDefaults?: boolean;
}) {
  const fields = queueDefaults ? numberFields.slice(0, 2) : numberFields;
  const inherit = queueDefaults ? 'Inherit aria2 default' : 'Inherit';
  return (
    <div className="grid grid-cols-2 gap-3 max-[360px]:grid-cols-1">
      {fields.map(([field, label]) => (
        <label key={field} className="workflow-field">
          {label}
          <input
            inputMode="numeric"
            maxLength={10}
            placeholder={inherit}
            value={value[field]}
            onChange={(event) =>
              onChange({ ...value, [field]: event.target.value })
            }
          />
        </label>
      ))}
      <label className="workflow-field">
        File allocation
        <select
          value={value.alloc_strategy}
          onChange={(event) =>
            onChange({ ...value, alloc_strategy: event.target.value })
          }
        >
          <option value="">{inherit}</option>
          {Object.entries(allocations).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="workflow-field">
        Piece selection
        <select
          value={value.stream_piece_selector}
          onChange={(event) =>
            onChange({ ...value, stream_piece_selector: event.target.value })
          }
        >
          <option value="">{inherit}</option>
          {Object.entries(selectors).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
