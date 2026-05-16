"use strict";

const { z } = require("zod");
const { requirePermission } = require("../middleware/requirePermission");
const streamingAgent = require("../services/streamingAgent");

const streamBodySchema = z.object({
  question: z.string().trim().min(1).max(2000),
});

function writeSse(res, event) {
  if (res.writableEnded) return;
  const payload = JSON.stringify(event || {});
  res.write(`event: ${event?.type || "message"}\n`);
  res.write(`data: ${payload}\n\n`);
}

function register(app, ctx) {
  const {
    express,
    parsePositiveInt,
    aiReportLimiter = (_req, _res, next) => next(),
  } = ctx;

  app.get("/api/agent/tools", requirePermission("analysis"), (_req, res) => {
    res.json({
      ok: true,
      items: streamingAgent.listTools(),
    });
  });

  app.get("/api/agent/runs", requirePermission("analysis"), async (req, res, next) => {
    try {
      const page = parsePositiveInt(req.query.page, 1);
      const pageSize = Math.min(100, parsePositiveInt(req.query.pageSize, 20));
      const payload = await streamingAgent.listRuns({ page, pageSize });
      res.json({ ok: true, ...payload });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/agent/runs/:id", requirePermission("analysis"), async (req, res, next) => {
    try {
      const detail = await streamingAgent.getRunDetail(req.params.id);
      if (!detail) {
        return res.status(404).json({ ok: false, message: "run not found" });
      }
      return res.json({ ok: true, ...detail });
    } catch (err) {
      next(err);
      return null;
    }
  });

  app.post(
    "/api/agent/react/stream",
    requirePermission("analysis"),
    express.json({ limit: "1mb" }),
    aiReportLimiter,
    async (req, res) => {
      const parsed = streamBodySchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          message: parsed.error.issues?.[0]?.message || "Invalid request body",
        });
      }

      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      const abortController = new AbortController();
      const abort = () => abortController.abort();
      req.on("aborted", abort);
      res.on("close", () => {
        if (!res.writableEnded) abort();
      });

      try {
        const generator = streamingAgent.executeReactStream(
          {
            question: parsed.data.question,
            user: req.authSession,
          },
          { signal: abortController.signal }
        );

        while (true) {
          const { value, done } = await generator.next();
          if (value) writeSse(res, value);
          if (done) break;
        }
      } catch (err) {
        writeSse(res, {
          type: "run:failed",
          code: err.code || "UNKNOWN_ERROR",
          message: err.message || String(err),
        });
      } finally {
        req.off("aborted", abort);
        if (!res.writableEnded) {
          res.end();
        }
      }
      return null;
    }
  );
}

module.exports = { register };
