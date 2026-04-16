import { seedTickets } from "../shared/seed.js";
import { computeEscalationScore, describeRisk, inEscalationQueue } from "../shared/risk.js";
import { summarizeTickets } from "../shared/summary.js";
import type { NoteInput, SupportTicket, TicketView } from "../shared/types.js";

type Filters = {
  status?: string;
  query?: string;
  queue?: string;
};

function cloneTicket(ticket: SupportTicket): SupportTicket {
  return {
    ...ticket,
    tags: [...ticket.tags],
    notes: ticket.notes.map((note) => ({ ...note })),
  };
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function matchesQuery(ticket: SupportTicket, query: string): boolean {
  if (!query) return true;
  const haystack = [
    ticket.id,
    ticket.subject,
    ticket.customer,
    ticket.assignee,
    ticket.summary,
    ticket.status,
    ticket.priority,
    ticket.channel,
    ...ticket.tags,
    ...ticket.notes.map((note) => `${note.author} ${note.body}`),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function enrichTicket(ticket: SupportTicket): TicketView {
  const riskScore = computeEscalationScore(ticket);
  return {
    ...cloneTicket(ticket),
    riskScore,
    riskLabel: describeRisk(riskScore),
    queue: inEscalationQueue(ticket) ? "escalation" : "standard",
  };
}

export function createSupportStore(seed: SupportTicket[] = seedTickets) {
  let tickets = seed.map(cloneTicket);
  const existingNoteCount = tickets.reduce((count, ticket) => count + ticket.notes.length, 0);
  let nextNoteId = existingNoteCount + 1;

  return {
    listTickets(filters: Filters = {}): TicketView[] {
      const status = normalize(filters.status ?? "");
      const query = normalize(filters.query ?? "");
      const queue = normalize(filters.queue ?? "");

      return tickets
        .filter((ticket) => {
          if (status && status !== "all" && ticket.status !== status) return false;
          if (!matchesQuery(ticket, query)) return false;
          if (queue === "escalation" && !inEscalationQueue(ticket)) return false;
          return true;
        })
        .sort((a, b) => {
          const riskDelta = computeEscalationScore(b) - computeEscalationScore(a);
          if (riskDelta !== 0) return riskDelta;
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        })
        .map(enrichTicket);
    },

    getTicket(id: string): TicketView | null {
      const ticket = tickets.find((entry) => entry.id === id);
      return ticket ? enrichTicket(ticket) : null;
    },

    addNote(id: string, input: NoteInput): TicketView | null {
      const ticket = tickets.find((entry) => entry.id === id);
      if (!ticket) return null;

      const now = new Date().toISOString();
      const note = {
        id: `note-${nextNoteId++}`,
        author: input.author,
        body: input.body,
        createdAt: now,
        internal: true,
      };

      ticket.notes = [...ticket.notes, note];
      ticket.updatedAt = now;
      return enrichTicket(ticket);
    },

    getSummary() {
      return summarizeTickets(tickets);
    },
  };
}
