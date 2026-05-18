"use strict";

/**
 * Outlet assortment report endpoints.
 *
 * This module mirrors the legacy Excel "明细" sheet for the outlet assortment
 * workflow, but calculates values from PostgreSQL instead of preserving Excel
 * formulas.
 */

const { requirePermission } = require("../middleware/requirePermission");
const { buildOutletAssortmentBuffer } = require("../lib/report/outletAssortmentWorkbook");

function register(app, ctx) {
  const {
    reportRepo,
    parsePositiveInt,
    stampNow,
    excelExportLimiter = (_req, _res, next) => next(),
  } = ctx;

  async function resolveRangeFromQuery(req) {
    const dateFromRaw = String(req.query.dateFrom || "").trim();
    const dateToRaw = String(req.query.dateTo || "").trim();
    return reportRepo.resolveOutletAssortmentRange(dateFromRaw, dateToRaw);
  }

  app.get("/api/outlet-assortment/dates", requirePermission("report_daily"), async (_req, res, next) => {
    try {
      const payload = await reportRepo.getOutletAssortmentDateChoices();
      res.json({
        ok: true,
        sales_dates: payload.salesDates,
        default_date_from: payload.defaultDateFrom,
        default_date_to: payload.defaultDateTo,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/outlet-assortment/meta", requirePermission("report_daily"), async (req, res, next) => {
    try {
      const { dateFrom, dateTo, salesDates } = await resolveRangeFromQuery(req);
      if (!dateFrom || !dateTo) {
        return res.status(404).json({ ok: false, message: "No outlet assortment date available." });
      }
      const meta = await reportRepo.getOutletAssortmentMeta({ dateFrom, dateTo });
      return res.json({
        ok: true,
        date_from: dateFrom,
        date_to: dateTo,
        sales_dates: salesDates,
        ...meta,
      });
    } catch (err) {
      next(err);
      return null;
    }
  });

  app.get("/api/outlet-assortment/rows", requirePermission("report_daily"), async (req, res, next) => {
    try {
      const { dateFrom, dateTo } = await resolveRangeFromQuery(req);
      if (!dateFrom || !dateTo) {
        return res.status(404).json({ ok: false, message: "No outlet assortment date available." });
      }
      const page = parsePositiveInt(req.query.page, 1);
      const pageSize = Math.min(500, parsePositiveInt(req.query.pageSize, 50));
      const keyword = String(req.query.keyword || "");
      const fuzzy = String(req.query.fuzzy || "").trim() === "1";
      const payload = await reportRepo.getOutletAssortmentRows({
        dateFrom,
        dateTo,
        page,
        pageSize,
        keyword,
        fuzzy,
      });
      return res.json({
        ok: true,
        date_from: dateFrom,
        date_to: dateTo,
        ...payload,
      });
    } catch (err) {
      next(err);
      return null;
    }
  });

  app.get(
    "/api/outlet-assortment/export.xlsx",
    requirePermission("report_daily"),
    excelExportLimiter,
    async (req, res, next) => {
      try {
        const { dateFrom, dateTo } = await resolveRangeFromQuery(req);
        if (!dateFrom || !dateTo) {
          return res.status(404).json({ ok: false, message: "No outlet assortment date available." });
        }
        const meta = await reportRepo.getOutletAssortmentMeta({ dateFrom, dateTo });
        const rows = await reportRepo.getOutletAssortmentExportRows({ dateFrom, dateTo });
        const buf = await buildOutletAssortmentBuffer({
          columns: reportRepo.OUTLET_ASSORTMENT_COLUMNS,
          groupHeaders: meta.group_headers,
          rows,
        });
        const filename = `奥莱货盘_${dateFrom.replace(/-/g, "")}_${dateTo.replace(/-/g, "")}_${stampNow()}.xlsx`;
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        return res.send(Buffer.from(buf));
      } catch (err) {
        next(err);
        return null;
      }
    }
  );
}

module.exports = { register };
