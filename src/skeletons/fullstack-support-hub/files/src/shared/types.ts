export type TicketStatus = "open" | "waiting" | "resolved";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type TicketChannel = "email" | "chat" | "phone" | "portal";

export interface TicketNote {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  internal: boolean;
}

export interface SupportTicket {
  id: string;
  subject: string;
  customer: string;
  status: TicketStatus;
  priority: TicketPriority;
  channel: TicketChannel;
  assignee: string;
  summary: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  notes: TicketNote[];
}

export interface TicketView extends SupportTicket {
  riskScore: number;
  riskLabel: string;
  queue: "escalation" | "standard";
}

export interface DashboardSummary {
  openCount: number;
  waitingCount: number;
  urgentCount: number;
  queueCount: number;
  averageAgeHours: number;
}

export interface DashboardPayload {
  tickets: TicketView[];
  summary: DashboardSummary;
}

export interface NoteInput {
  author: string;
  body: string;
}
