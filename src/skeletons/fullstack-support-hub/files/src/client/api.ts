import type { DashboardPayload, NoteInput } from "../shared/types.js";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function loadDashboard(filters?: {
  status?: string;
  query?: string;
  queue?: string;
}): Promise<DashboardPayload> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.query) params.set("query", filters.query);
  if (filters?.queue) params.set("queue", filters.queue);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return requestJson<DashboardPayload>(`/api/dashboard${suffix}`);
}

export async function addTicketNote(ticketId: string, note: NoteInput): Promise<DashboardPayload> {
  return requestJson<DashboardPayload>(`/api/tickets/${ticketId}/notes`, {
    method: "POST",
    body: JSON.stringify(note),
  });
}
