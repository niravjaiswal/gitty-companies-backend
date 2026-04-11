interface TimelineItem {
  time: string;
  title: string;
  detail: string;
}

export function TimelineFeed({ items }: { items: TimelineItem[] }) {
  return (
    <div className="timeline">
      {items.map((item) => (
        <article key={item.time} className="timeline-item">
          <span className="timeline-time">{item.time}</span>
          <div>
            <p className="timeline-title">{item.title}</p>
            <p className="timeline-detail">{item.detail}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
