interface SidebarSummaryProps {
  title: string;
  launchPercent: number;
  readyCount: number;
  totalCount: number;
}

export function SidebarSummary({
  title,
  launchPercent,
  readyCount,
  totalCount,
}: SidebarSummaryProps) {
  return (
    <aside className="sidebar">
      <div>
        <p className="eyebrow">Launch workspace</p>
        <h1>{title}</h1>
        <p className="lede">
          A product-style dashboard with a real feature task inside a normal React codebase.
        </p>
      </div>

      <div className="sidebar-card">
        <span>Launch confidence</span>
        <strong>{launchPercent}%</strong>
        <p>{readyCount} of {totalCount} checklist items are launch-ready.</p>
      </div>

      <div className="sidebar-card muted">
        <span>Suggested commands</span>
        <code>npm install</code>
        <code>npm run dev -- --host 0.0.0.0 --port 3000</code>
        <code>npm run test</code>
      </div>
    </aside>
  );
}
