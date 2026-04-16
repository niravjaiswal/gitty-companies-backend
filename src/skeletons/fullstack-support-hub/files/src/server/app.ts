import express from "express";
import type { Request, Response } from "express";
import { createSupportStore } from "./store.js";

function sendJsonError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

export function createApp() {
  const app = express();
  const store = createSupportStore();

  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/dashboard", (req: Request, res: Response) => {
    const tickets = store.listTickets({
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      query: typeof req.query.query === "string" ? req.query.query : undefined,
      queue: typeof req.query.queue === "string" ? req.query.queue : undefined,
    });

    res.json({
      tickets,
      summary: store.getSummary(),
    });
  });

  app.get("/api/tickets/:id", (req: Request, res: Response) => {
    const ticket = store.getTicket(req.params.id);
    if (!ticket) {
      sendJsonError(res, 404, "Ticket not found");
      return;
    }

    res.json(ticket);
  });

  app.post("/api/tickets/:id/notes", (req: Request, res: Response) => {
    const body = req.body as { author?: unknown; body?: unknown };
    if (typeof body.author !== "string" || !body.author.trim()) {
      sendJsonError(res, 400, "Note author is required");
      return;
    }
    if (typeof body.body !== "string" || !body.body.trim()) {
      sendJsonError(res, 400, "Note body is required");
      return;
    }

    const ticket = store.addNote(req.params.id, {
      author: body.author.trim(),
      body: body.body.trim(),
    });

    if (!ticket) {
      sendJsonError(res, 404, "Ticket not found");
      return;
    }

    res.status(201).json({
      tickets: store.listTickets({}),
      summary: store.getSummary(),
    });
  });

  return app;
}
