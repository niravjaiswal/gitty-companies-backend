import { useEffect, useMemo, useState, type FormEvent } from "react";
import { addTicketNote, loadDashboard } from "./client/api.js";
import { computeEscalationScore, describeRisk } from "./shared/risk.js";
import { summarizeTickets } from "./shared/summary.js";
import type { DashboardPayload, SupportTicket, TicketView } from "./shared/types.js";

const FILTERS = ["all", "open", "waiting", "resolved"] as const;

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function TicketChip({ ticket }: { ticket: TicketView }) {
  return (
    <div className="ticket-chip">
      <span className={`pill pill-${ticket.priority}`}>{ticket.priority}</span>
      <span className={`pill pill-${ticket.status}`}>{ticket.status}</span>
      <span className="risk-pill">{ticket.riskLabel}</span>
    </div>
  );
}

function SupportMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof FILTERS)[number]>("all");
  const [author, setAuthor] = useState("");
  const [body, setBody] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    void loadDashboard()
      .then((payload) => {
        if (!active) return;
        setDashboard(payload);
        setSelectedId(payload.tickets[0]?.id ?? "");
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      })
      .finally(() => {
        if (!active) return;
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const visibleTickets = useMemo(() => {
    const tickets = dashboard?.tickets ?? [];
    const normalized = query.trim().toLowerCase();

    return tickets.filter((ticket) => {
      const matchesStatus = status === "all" || ticket.status === status;
      const haystack = [
        ticket.subject,
        ticket.customer,
        ticket.assignee,
        ticket.summary,
        ticket.channel,
        ticket.priority,
        ticket.status,
        ticket.tags.join(" "),
        ...ticket.notes.map((note) => `${note.author} ${note.body}`),
      ]
        .join(" ")
        .toLowerCase();

      return matchesStatus && haystack.includes(normalized);
    });
  }, [dashboard, query, status]);

  useEffect(() => {
    if (!visibleTickets.length) {
      setSelectedId("");
      return;
    }

    if (!visibleTickets.some((ticket) => ticket.id === selectedId)) {
      setSelectedId(visibleTickets[0].id);
    }
  }, [selectedId, visibleTickets]);

  const selectedTicket = useMemo(
    () => visibleTickets.find((ticket) => ticket.id === selectedId) ?? visibleTickets[0] ?? null,
    [selectedId, visibleTickets],
  );

  const summary = useMemo(() => {
    if (!dashboard) return null;
    return summarizeTickets(dashboard.tickets);
  }, [dashboard]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTicket) return;
    if (!author.trim() || !body.trim()) return;

    setSaving(true);
    setError("");

    try {
      const payload = await addTicketNote(selectedTicket.id, {
        author: author.trim(),
        body: body.trim(),
      });
      setDashboard(payload);
      setBody("");
      setSelectedId(payload.tickets.find((ticket) => ticket.id === selectedTicket.id)?.id ?? selectedTicket.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add note");
    } finally {
      setSaving(false);
    }
  }

  const queueTickets = useMemo(() => {
    const tickets = dashboard?.tickets ?? [];
    return tickets.filter((ticket) => ticket.queue === "escalation").slice(0, 3);
  }, [dashboard]);

  return (
    <div className="app-shell">
      <aside className="rail">
        <div>
          <p className="eyebrow">Northstar Support Hub</p>
          <h1>Escalation control for a busy product support queue.</h1>
          <p className="lede">
            Agents triage customer issues, add internal notes, and keep an eye on tickets that are drifting toward the
            escalation queue.
          </p>
        </div>

        <div className="stack">
          <article className="info-card">
            <span>Queue focus</span>
            <strong>{summary ? summary.queueCount : "—"}</strong>
            <p>Tickets needing escalation review</p>
          </article>
          <article className="info-card">
            <span>Median pressure</span>
            <strong>{summary ? `${summary.averageAgeHours.toFixed(1)}h` : "—"}</strong>
            <p>Average ticket age in the active board</p>
          </article>
        </div>

        <div className="queue-card">
          <div className="queue-card-header">
            <span>Escalation queue</span>
            <strong>{queueTickets.length}</strong>
          </div>
          <ul>
            {queueTickets.map((ticket) => (
              <li key={ticket.id}>
                <span>{ticket.subject}</span>
                <small>
                  {ticket.customer} · {describeRisk(computeEscalationScore(ticket))}
                </small>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="workspace">
        <header className="hero">
          <div>
            <p className="eyebrow">API-backed dashboard</p>
            <h2>Keep high-friction tickets visible before they spill into incident handling.</h2>
          </div>
          <div className="metric-grid">
            <SupportMetric
              label="Open"
              value={summary ? String(summary.openCount).padStart(2, "0") : "—"}
              detail="Tickets still active in the board"
            />
            <SupportMetric
              label="Waiting"
              value={summary ? String(summary.waitingCount).padStart(2, "0") : "—"}
              detail="Tickets blocked on a customer reply"
            />
            <SupportMetric
              label="Urgent"
              value={summary ? String(summary.urgentCount).padStart(2, "0") : "—"}
              detail="Tickets already marked urgent"
            />
          </div>
        </header>

        <section className="panel">
          <div className="panel-toolbar">
            <input
              aria-label="Search tickets"
              className="search"
              placeholder="Search customer, subject, tag, or assignee"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="segmented" role="tablist" aria-label="Status filter">
              {FILTERS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={option === status ? "segmented-option active" : "segmented-option"}
                  onClick={() => setStatus(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          {error ? <p className="banner banner-error">{error}</p> : null}
          {isLoading ? <p className="banner">Loading support board…</p> : null}

          <div className="board">
            <section className="ticket-list" aria-label="Ticket queue">
              {visibleTickets.map((ticket) => (
                <button
                  key={ticket.id}
                  type="button"
                  className={ticket.id === selectedId ? "ticket-row active" : "ticket-row"}
                  onClick={() => setSelectedId(ticket.id)}
                >
                  <div className="ticket-row-top">
                    <strong>{ticket.subject}</strong>
                    <span>{ticket.id}</span>
                  </div>
                  <p>{ticket.customer} · {ticket.assignee}</p>
                  <TicketChip ticket={ticket} />
                </button>
              ))}
              {!visibleTickets.length && !isLoading ? <p className="empty-state">No tickets match the current filter.</p> : null}
            </section>

            <section className="detail" aria-label="Ticket details">
              {selectedTicket ? (
                <>
                  <div className="detail-head">
                    <div>
                      <p className="eyebrow">Selected ticket</p>
                      <h3>{selectedTicket.subject}</h3>
                      <p className="subtle">
                        {selectedTicket.customer} · {selectedTicket.channel} · Updated {formatTime(selectedTicket.updatedAt)}
                      </p>
                    </div>
                    <TicketChip ticket={selectedTicket} />
                  </div>

                  <div className="detail-grid">
                    <article className="detail-card">
                      <span>Summary</span>
                      <p>{selectedTicket.summary}</p>
                    </article>
                    <article className="detail-card">
                      <span>Ownership</span>
                      <p>
                        {selectedTicket.assignee} · {selectedTicket.priority}
                      </p>
                    </article>
                  </div>

                  <div className="notes">
                    <div className="notes-head">
                      <h4>Internal notes</h4>
                      <span>{selectedTicket.notes.length} entries</span>
                    </div>
                    {selectedTicket.notes.map((note) => (
                      <article key={note.id} className="note">
                        <strong>
                          {note.author}
                          {note.internal ? " · internal" : ""}
                        </strong>
                        <p>{note.body}</p>
                        <small>{formatTime(note.createdAt)}</small>
                      </article>
                    ))}
                  </div>

                  <form className="composer" onSubmit={handleSubmit}>
                    <div className="composer-grid">
                      <label>
                        <span>Author</span>
                        <input
                          aria-label="Note author"
                          data-testid="note-author"
                          value={author}
                          onChange={(event) => setAuthor(event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Note</span>
                        <input
                          aria-label="Note body"
                          data-testid="note-body"
                          value={body}
                          onChange={(event) => setBody(event.target.value)}
                          placeholder="Capture the next action or unblocker"
                        />
                      </label>
                    </div>
                    <button type="submit" className="primary" disabled={saving}>
                      {saving ? "Saving…" : "Add note"}
                    </button>
                  </form>
                </>
              ) : (
                <div className="empty-detail">
                  <h3>No ticket selected</h3>
                  <p>Select a row to review the full ticket history.</p>
                </div>
              )}
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}
