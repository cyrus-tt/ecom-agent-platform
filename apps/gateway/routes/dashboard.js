"use strict";

/**
 * Dashboard and channel-dashboard endpoints.
 *
 * Exports:
 *   - /api/dashboard/*        — comprehensive dashboard (dates, overview,
 *                                channel-compare, drilldown)
 *   - /api/channel-dashboard/* — channel/store dashboard + style drilldown
 */

const { requirePermission } = require("../middleware/requirePermission");

function register(app, ctx) {
  const { reportRepo, parsePositiveInt } = ctx;

  // ── Comprehensive dashboard ────────────────────────────────────────

  app.get("/api/dashboard/dates", requirePermission("dashboard"), async (_req, res, next) => {
    try {
      const payload = await reportRepo.getDashboardDateChoices();
      res.json({
        ok: true,
        ...payload,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/dashboard/overview", requirePermission("dashboard"), async (req, res, next) => {
    try {
      const anchorDate = String(req.query.anchor_date || "").trim();
      const dateFrom = String(req.query.date_from || "").trim();
      const dateTo = String(req.query.date_to || "").trim();
      const payload = await reportRepo.getDashboardOverview(anchorDate, dateFrom, dateTo);
      res.json({
        ok: true,
        ...payload,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/dashboard/channel-compare", requirePermission("dashboard"), async (req, res, next) => {
    try {
      const dateFrom = String(req.query.date_from || "").trim();
      const dateTo = String(req.query.date_to || "").trim();
      const rawChannels = Array.isArray(req.query.channels)
        ? req.query.channels.join(",")
        : String(req.query.channels || "").trim();
      const payload = await reportRepo.getDashboardChannelCompare({
        dateFromText: dateFrom,
        dateToText: dateTo,
        channelCodesText: rawChannels,
      });
      res.json({
        ok: true,
        ...payload,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/dashboard/drilldown", requirePermission("dashboard"), async (req, res, next) => {
    try {
      const anchorDate = String(req.query.anchor_date || "").trim();
      const dateFrom = String(req.query.date_from || "").trim();
      const dateTo = String(req.query.date_to || "").trim();
      const category = String(req.query.category || "").trim();
      const level = String(req.query.level || "").trim().toLowerCase();
      const style = String(req.query.style || "").trim();
      const page = parsePositiveInt(req.query.page, 1);
      const pageSize = Math.min(100, parsePositiveInt(req.query.pageSize, 20));

      if (!category) {
        return res.status(400).json({ ok: false, message: "category is required" });
      }
      if (level !== "style" && level !== "sku") {
        return res.status(400).json({ ok: false, message: "level must be style or sku" });
      }
      if (level === "sku" && !style) {
        return res.status(400).json({ ok: false, message: "style is required when level=sku" });
      }

      const payload = await reportRepo.getDashboardDrilldown({
        anchorDateText: anchorDate,
        dateFromText: dateFrom,
        dateToText: dateTo,
        category,
        level,
        style,
        page,
        pageSize,
      });
      res.json({
        ok: true,
        ...payload,
      });
    } catch (err) {
      next(err);
    }
  });

  // ── Channel dashboard ──────────────────────────────────────────────

  app.get("/api/channel-dashboard", requirePermission("channel_dashboard"), async (req, res, next) => {
    try {
      const anchorDate = String(req.query.anchor_date || "").trim();
      const dateFrom = String(req.query.date_from || "").trim();
      const dateTo = String(req.query.date_to || "").trim();
      const comparisonDateFrom = String(req.query.comparison_date_from || "").trim();
      const comparisonDateTo = String(req.query.comparison_date_to || "").trim();
      const rawChannels = Array.isArray(req.query.channels)
        ? req.query.channels.join(",")
        : String(req.query.channels || "").trim();
      const payload = await reportRepo.getChannelDashboard({
        anchorDateText: anchorDate,
        dateFromText: dateFrom,
        dateToText: dateTo,
        channelCodesText: rawChannels,
        comparisonDateFromText: comparisonDateFrom,
        comparisonDateToText: comparisonDateTo,
      });
      res.json({
        ok: true,
        ...payload,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get(
    "/api/channel-dashboard/drilldown",
    requirePermission("channel_dashboard"),
    async (req, res, next) => {
      try {
        const anchorDate = String(req.query.anchor_date || "").trim();
        const dateFrom = String(req.query.date_from || "").trim();
        const dateTo = String(req.query.date_to || "").trim();
        const channel = String(req.query.channel || "").trim();
        const style = String(req.query.style || "").trim();

        if (!channel) {
          return res.status(400).json({ ok: false, message: "channel is required" });
        }
        if (!style) {
          return res.status(400).json({ ok: false, message: "style is required" });
        }

        const payload = await reportRepo.getChannelDashboardStyleDrilldown({
          anchorDateText: anchorDate,
          dateFromText: dateFrom,
          dateToText: dateTo,
          channelCode: channel,
          style,
        });
        res.json({
          ok: true,
          ...payload,
        });
      } catch (err) {
        next(err);
      }
    }
  );
}

module.exports = { register };
