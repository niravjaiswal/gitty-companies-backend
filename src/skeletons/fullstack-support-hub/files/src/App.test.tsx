import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.js";
import type { DashboardPayload } from "./shared/types.js";

const payload: DashboardPayload = {
  tickets: [
    {
      id: "SH-201",
      subject: "Billing export is missing line-item tax",
      customer: "Northwind Labs",
      status: "waiting",
      priority: "high",
      channel: "email",
      assignee: "Mara",
      summary: "Finance reports show a mismatch after the latest reconciliation export.",
      tags: ["billing"],
      createdAt: "2026-04-15T10:00:00.000Z",
      updatedAt: "2026-04-15T12:15:00.000Z",
      notes: [
        {
          id: "note-1",
          author: "Mara",
          body: "Asked finance to send the sample export.",
          createdAt: "2026-04-15T12:15:00.000Z",
          internal: true,
        },
      ],
      riskScore: 5,
      riskLabel: "At risk",
      queue: "escalation",
    },
    {
      id: "SH-205",
      subject: "Mobile upload spinner never clears",
      customer: "Brightside Health",
      status: "open",
      priority: "urgent",
      channel: "phone",
      assignee: "Jun",
      summary: "Users on mobile see a persistent spinner after attaching files.",
      tags: ["mobile"],
      createdAt: "2026-04-15T11:30:00.000Z",
      updatedAt: "2026-04-15T12:28:00.000Z",
      notes: [],
      riskScore: 7,
      riskLabel: "Critical",
      queue: "escalation",
    },
    {
      id: "SH-219",
      subject: "Resolved ticket still appears in the queue",
      customer: "Cobalt Works",
      status: "resolved",
      priority: "low",
      channel: "email",
      assignee: "Mara",
      summary: "A stale dashboard row is confusing the support lead after closure.",
      tags: ["ui"],
      createdAt: "2026-04-14T12:00:00.000Z",
      updatedAt: "2026-04-15T12:32:00.000Z",
      notes: [],
      riskScore: 1,
      riskLabel: "Stable",
      queue: "standard",
    },
  ],
  summary: {
    openCount: 2,
    waitingCount: 1,
    urgentCount: 1,
    queueCount: 2,
    averageAgeHours: 2.3,
  },
};

const apiMock = vi.hoisted(() => ({
  loadDashboard: vi.fn(),
  addTicketNote: vi.fn(),
}));

vi.mock("./client/api.js", () => apiMock);

beforeEach(() => {
  apiMock.loadDashboard.mockResolvedValue(payload);
  apiMock.addTicketNote.mockResolvedValue({
    ...payload,
    tickets: payload.tickets.map((ticket) =>
      ticket.id === "SH-201"
        ? {
            ...ticket,
            notes: [
              ...ticket.notes,
              {
                id: "note-2",
                author: "Avery",
                body: "Waiting on finance for the CSV sample.",
                createdAt: "2026-04-15T12:40:00.000Z",
                internal: true,
              },
            ],
          }
        : ticket,
    ),
  });
});

describe("Northstar Support Hub", () => {
  it("filters tickets by status and search text", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByRole("button", { name: /billing export is missing line-item tax/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "resolved" }));
    expect(
      screen.getByRole("button", { name: /resolved ticket still appears in the queue/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /billing export is missing line-item tax/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "all" }));
    await user.clear(screen.getByLabelText(/search tickets/i));
    await user.type(screen.getByLabelText(/search tickets/i), "northwind");
    expect(
      screen.getByRole("button", { name: /billing export is missing line-item tax/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /resolved ticket still appears in the queue/i }),
    ).not.toBeInTheDocument();
  });

  it("adds a note to the selected ticket and refreshes the detail panel", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("button", { name: /billing export is missing line-item tax/i });
    await user.type(screen.getByTestId("note-author"), "Avery");
    await user.type(screen.getByTestId("note-body"), "Waiting on finance for the CSV sample.");
    await user.click(screen.getByRole("button", { name: /add note/i }));

    expect(apiMock.addTicketNote).toHaveBeenCalledWith("SH-201", {
      author: "Avery",
      body: "Waiting on finance for the CSV sample.",
    });
    expect(
      screen.getByRole("button", { name: /billing export is missing line-item tax/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/waiting on finance for the csv sample/i)).toBeInTheDocument();
    expect(screen.getByText(/2 entries/i)).toBeInTheDocument();
  });
});
