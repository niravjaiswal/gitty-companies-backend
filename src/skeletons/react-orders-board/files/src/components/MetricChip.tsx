export interface MetricChipProps {
  label: string;
  value: string | number;
  hint?: string;
}

export function MetricChip({ label, value, hint }: MetricChipProps) {
  return (
    <article className="metric-chip">
      <span className="metric-chip__value">{value}</span>
      <span className="metric-chip__label">{label}</span>
      {hint ? <span className="metric-chip__hint">{hint}</span> : null}
    </article>
  );
}
