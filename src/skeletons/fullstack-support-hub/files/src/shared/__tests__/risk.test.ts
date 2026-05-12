import { describe, it, expect } from "vitest";
import {
  computeEscalationScore,
  describeRisk,
  inEscalationQueue,
} from "../risk.js";
import type { SupportTicket, TicketNote } from "../types.js";

function minutesAgoISO(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function note(overrides: Partial<TicketNote> = {}): TicketNote {
  return {
    id: "n",
    author: "agent",
    body: "ack",
    createdAt: minutesAgoISO(5),
    internal: true,
    ...overrides,
  };
}

function makeTicket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: "T-1",
    subject: "subject",
    customer: "Acme",
    status: "open",
    priority: "low",
    channel: "email",
    assignee: "agent",
    summary: "summary",
    tags: [],
    createdAt: minutesAgoISO(10),
    updatedAt: minutesAgoISO(10),
    notes: [note()],
    ...overrides,
  };
}

describe("computeEscalationScore — baseline", () => {
  it("returns 0 for the most benign ticket shape", () => {
    const t = makeTicket();
    expect(computeEscalationScore(t)).toBe(0);
  });

  it("is deterministic — repeat calls return the same score for the same ticket", () => {
    const t = makeTicket({ priority: "high", status: "waiting" });
    const a = computeEscalationScore(t);
    const b = computeEscalationScore(t);
    const c = computeEscalationScore(t);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe("computeEscalationScore — priority weighting", () => {
  it("adds 4 for urgent priority", () => {
    const base = computeEscalationScore(makeTicket());
    const t = makeTicket({ priority: "urgent" });
    expect(computeEscalationScore(t)).toBe(base + 4);
  });

  it("adds 2 for high priority", () => {
    const base = computeEscalationScore(makeTicket());
    const t = makeTicket({ priority: "high" });
    expect(computeEscalationScore(t)).toBe(base + 2);
  });

  it("adds 1 for medium priority", () => {
    const base = computeEscalationScore(makeTicket());
    const t = makeTicket({ priority: "medium" });
    expect(computeEscalationScore(t)).toBe(base + 1);
  });

  it("adds nothing for low priority", () => {
    const base = computeEscalationScore(makeTicket());
    expect(base).toBe(0);
  });
});

describe("computeEscalationScore — status, channel, tag, notes", () => {
  it("adds 2 for waiting status", () => {
    const t = makeTicket({ status: "waiting" });
    expect(computeEscalationScore(t)).toBe(2);
  });

  it("adds 1 for phone channel", () => {
    const t = makeTicket({ channel: "phone" });
    expect(computeEscalationScore(t)).toBe(1);
  });

  it("adds 1 when notes are empty (signal of missing follow-up)", () => {
    const t = makeTicket({ notes: [] });
    expect(computeEscalationScore(t)).toBe(1);
  });

  it("adds 1 for vip tag", () => {
    const t = makeTicket({ tags: ["vip"] });
    expect(computeEscalationScore(t)).toBe(1);
  });

  it("does not double-count vip when tag list contains other entries", () => {
    const t = makeTicket({ tags: ["billing", "vip", "finance"] });
    expect(computeEscalationScore(t)).toBe(1);
  });
});

describe("computeEscalationScore — age boundary thresholds", () => {
  it("adds nothing when age is just below the 90-minute boundary", () => {
    const t = makeTicket({ updatedAt: minutesAgoISO(89) });
    expect(computeEscalationScore(t)).toBe(0);
  });

  it("adds 1 when age is exactly at the 90-minute boundary", () => {
    const t = makeTicket({ updatedAt: minutesAgoISO(90) });
    expect(computeEscalationScore(t)).toBe(1);
  });

  it("adds 1 when age is just below the 240-minute boundary", () => {
    const t = makeTicket({ updatedAt: minutesAgoISO(239) });
    expect(computeEscalationScore(t)).toBe(1);
  });

  it("adds 2 when age is at the 240-minute boundary (stale)", () => {
    const t = makeTicket({ updatedAt: minutesAgoISO(240) });
    expect(computeEscalationScore(t)).toBe(2);
  });

  it("treats clock skew (future updatedAt) as zero age, not negative", () => {
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const t = makeTicket({ updatedAt: future });
    expect(computeEscalationScore(t)).toBe(0);
  });
});

describe("computeEscalationScore — malformed input", () => {
  it("does not throw or escalate on a malformed updatedAt string", () => {
    const t = makeTicket({ updatedAt: "not-a-date" });
    expect(() => computeEscalationScore(t)).not.toThrow();
    expect(computeEscalationScore(t)).toBe(0);
  });

  it("treats an empty updatedAt string as no age signal (no boundary trigger)", () => {
    const t = makeTicket({ updatedAt: "" });
    const score = computeEscalationScore(t);
    expect(score).toBeLessThan(2);
  });
});

describe("computeEscalationScore — composite scenarios", () => {
  it("sums urgent + waiting + phone correctly", () => {
    const t = makeTicket({
      priority: "urgent",
      status: "waiting",
      channel: "phone",
    });
    expect(computeEscalationScore(t)).toBe(4 + 2 + 1);
  });

  it("captures a stale waiting vip ticket (high-risk profile)", () => {
    const t = makeTicket({
      priority: "high",
      status: "waiting",
      tags: ["vip"],
      updatedAt: minutesAgoISO(300),
    });
    expect(computeEscalationScore(t)).toBe(2 + 2 + 1 + 2);
  });

  it("does not double-trigger age (240+ does not also add the 90+ tier)", () => {
    const t = makeTicket({ updatedAt: minutesAgoISO(500) });
    expect(computeEscalationScore(t)).toBe(2);
  });
});

describe("describeRisk", () => {
  it("returns Stable below the Monitor threshold", () => {
    expect(describeRisk(0)).toBe("Stable");
    expect(describeRisk(1)).toBe("Stable");
  });

  it("returns Monitor at the boundary of 2", () => {
    expect(describeRisk(2)).toBe("Monitor");
    expect(describeRisk(3)).toBe("Monitor");
  });

  it("returns At risk at the boundary of 4", () => {
    expect(describeRisk(4)).toBe("At risk");
    expect(describeRisk(6)).toBe("At risk");
  });

  it("returns Critical at the boundary of 7", () => {
    expect(describeRisk(7)).toBe("Critical");
    expect(describeRisk(99)).toBe("Critical");
  });

  it("handles negative scores defensively as Stable", () => {
    expect(describeRisk(-1)).toBe("Stable");
  });
});

describe("inEscalationQueue", () => {
  it("returns false for a low-risk ticket", () => {
    expect(inEscalationQueue(makeTicket())).toBe(false);
  });

  it("returns true at the score boundary of 4", () => {
    const t = makeTicket({ priority: "urgent" });
    expect(computeEscalationScore(t)).toBe(4);
    expect(inEscalationQueue(t)).toBe(true);
  });

  it("returns false just below the boundary (score 3)", () => {
    const t = makeTicket({
      priority: "high",
      channel: "phone",
    });
    expect(computeEscalationScore(t)).toBe(3);
    expect(inEscalationQueue(t)).toBe(false);
  });
});
