import { computeEscalationScore } from "./risk.js";
import type { DashboardSummary, SupportTicket } from "./types.js";

function average(values: number[]): number {
  if (values.length === 0) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 10) / 10;
}

export function summarizeTickets(tickets: SupportTicket[]): DashboardSummary {
  const ages = tickets.map((ticket) =>
    Math.max(0, (Date.now() - new Date(ticket.updatedAt).getTime()) / 3_600_000),
  );

  return {
    openCount: tickets.filter((ticket) => ticket.status !== "resolved").length,
    waitingCount: tickets.filter((ticket) => ticket.status === "waiting").length,
    urgentCount: tickets.filter((ticket) => ticket.priority === "urgent").length,
    queueCount: tickets.filter((ticket) => computeEscalationScore(ticket) >= 4).length,
    averageAgeHours: average(ages),
  };
}
