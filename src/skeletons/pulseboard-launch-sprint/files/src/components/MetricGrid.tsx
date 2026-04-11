interface Metric {
  label: string;
  value: string;
  note: string;
}

export function MetricGrid({ stats }: { stats: Metric[] }) {
  return (
    <div className="hero-grid">
      {stats.map((stat) => (
        <article key={stat.label} className="metric-card">
          <span>{stat.label}</span>
          <strong>{stat.value}</strong>
          <p>{stat.note}</p>
        </article>
      ))}
    </div>
  );
}
