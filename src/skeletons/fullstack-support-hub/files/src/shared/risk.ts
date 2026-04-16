import type { SupportTicket } from "./types.js";

function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
}

export function computeEscalationScore(ticket: SupportTicket): number {
  let score = 0;

  if (ticket.priority === "urgent") {
    score += 4;
  } else if (ticket.priority === "high") {
    score += 2;
  } else if (ticket.priority === "medium") {
    score += 1;
  }

  if (ticket.status === "waiting") {
    score += 2;
  }

  if (ticket.channel === "phone") {
    score += 1;
  }

  if (ticket.notes.length === 0) {
    score += 1;
  }

  if (ticket.tags.includes("vip")) {
    score += 1;
  }

  const ageMinutes = minutesSince(ticket.updatedAt);
  if (ageMinutes >= 240) {
    score += 2;
  } else if (ageMinutes >= 90) {
    score += 1;
  }

  // TODO: weight repeated silent follow-ups and long gaps after customer replies.
  return score;
}

export function describeRisk(score: number): string {
  if (score >= 7) return "Critical";
  if (score >= 4) return "At risk";
  if (score >= 2) return "Monitor";
  return "Stable";
}

export function inEscalationQueue(ticket: SupportTicket): boolean {
  return computeEscalationScore(ticket) >= 4;
}
