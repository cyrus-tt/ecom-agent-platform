"use strict";

/**
 * Arrival service proxy + notes service forwarding.
 *
 * The upstream Python `arrival` service hosts /api/status, /api/data,
 * /api/config, /api/image/*, /api/refresh, /api/review. This module proxies
 * them through the gateway, adding auth gating, and exposes two URL shapes:
 *
 *   - /api/arrival/*  (preferred, namespaced)
 *   - /api/*          (legacy, kept for backward compatibility)
 *
 * Notes service routes at /notes-api/* forward to the Python `notes` service.
 */

const { requirePermission } = require("../middleware/requirePermission");
const { getAuthStore, isPrimaryAdminAccount } = require("../lib/auth/store");

function register(app, ctx) {
  const {
    express,
    proxyArrivalRequest,
    forwardNotesRequest,
  } = ctx;

  // ── user directory for note authoring ─────────────────────────────
  app.get("/api/arrival/note-users", requirePermission("arrival"), (req, res) => {
    const canViewAllNotes = isPrimaryAdminAccount(req.authSession?.account_id);
    const currentName = String(req.authSession?.name || "").trim();
    if (!canViewAllNotes) {
      return res.json({
        ok: true,
        users: currentName
          ? [
              {
                account_id: String(req.authSession?.account_id || "").trim(),
                name: currentName,
                is_primary_admin: false,
              },
            ]
          : [],
      });
    }

    const seenNames = new Set();
    const users = [];
    for (const account of getAuthStore().accounts || []) {
      const name = String(account?.name || "").trim();
      if (!name || seenNames.has(name)) {
        continue;
      }
      seenNames.add(name);
      users.push({
        account_id: account.id,
        name,
        is_primary_admin: isPrimaryAdminAccount(account.id),
      });
    }

    if (currentName && !seenNames.has(currentName)) {
      users.unshift({
        account_id: String(req.authSession?.account_id || "").trim(),
        name: currentName,
        is_primary_admin: req.authSession?.is_admin === true,
      });
    }

    return res.json({
      ok: true,
      users,
    });
  });

  // ── namespaced /api/arrival/* (preferred) ─────────────────────────
  app.all(
    ["/api/arrival/status", "/api/arrival/data", "/api/arrival/config", "/api/arrival/review"],
    requirePermission("arrival"),
    (req, res) => {
      proxyArrivalRequest(req, res, { stripPrefix: "/api/arrival", prependPath: "/api" });
    }
  );

  app.all("/api/arrival/image/*", (req, res) => {
    proxyArrivalRequest(req, res, { stripPrefix: "/api/arrival", prependPath: "/api" });
  });

  app.all("/api/arrival/refresh", requirePermission("arrival"), (req, res) => {
    proxyArrivalRequest(req, res, { stripPrefix: "/api/arrival", prependPath: "/api", timeoutMs: 600000 });
  });

  // ── legacy /api/* (kept for existing frontend paths) ──────────────
  app.all(
    ["/api/status", "/api/data", "/api/config", "/api/review"],
    requirePermission("arrival"),
    (req, res) => {
      proxyArrivalRequest(req, res);
    }
  );

  app.all("/api/image/*", (req, res) => {
    proxyArrivalRequest(req, res);
  });

  app.all("/api/refresh", requirePermission("arrival"), (req, res) => {
    proxyArrivalRequest(req, res, { timeoutMs: 600000 });
  });

  // ── notes service ──────────────────────────────────────────────────
  app.get("/notes-api/*", requirePermission("arrival"), (req, res) => {
    forwardNotesRequest(req, res);
  });

  app.post("/notes-api/*", requirePermission("arrival"), express.json({ limit: "2mb" }), (req, res) => {
    forwardNotesRequest(req, res);
  });
}

module.exports = { register };
