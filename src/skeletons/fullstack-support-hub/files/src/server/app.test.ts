// @vitest-environment node
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("Northstar Support Hub API", () => {
  it("serves the dashboard payload", async () => {
    const app = createApp();
    const response = await request(app).get("/api/dashboard");

    expect(response.status).toBe(200);
    expect(response.body.tickets).toHaveLength(5);
    expect(response.body.summary.queueCount).toBeGreaterThan(0);
    expect(response.body.tickets[0]).toHaveProperty("riskScore");
    expect(response.body.tickets[0]).toHaveProperty("riskLabel");
  });

  it("filters the dashboard by status and search query", async () => {
    const app = createApp();
    const response = await request(app)
      .get("/api/dashboard")
      .query({ status: "waiting", query: "billing" });

    expect(response.status).toBe(200);
    expect(response.body.tickets).toHaveLength(1);
    expect(response.body.tickets[0].id).toBe("SH-201");
  });

  it("adds a note and returns the refreshed dashboard summary", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/tickets/SH-201/notes")
      .send({ author: "Avery", body: "Waiting on finance for the CSV sample." });

    expect(response.status).toBe(201);
    expect(response.body.ticket.notes).toHaveLength(2);
    expect(response.body.summary.openCount).toBeGreaterThan(0);
  });

  it("rejects invalid notes", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/tickets/SH-201/notes")
      .send({ author: "", body: "" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/required/i);
  });
});
