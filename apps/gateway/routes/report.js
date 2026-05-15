"use strict";

/**
 * Weekly and daily report endpoints.
 *
 * Exports:
 *   - /api/report/*        — weekly report (weeks/meta/rows/export + gap template)
 *   - /api/report-daily/*  — daily report (dates/meta/rows/export xlsx & xlsb)
 *
 * All data comes from reportRepo (PostgreSQL); this layer only does HTTP I/O.
 */

const XLSX = require("xlsx");
const { requirePermission, requireAnyPermission } = require("../middleware/requirePermission");

function register(app, ctx) {
  const {
    reportRepo,
    parsePositiveInt,
    stampNow,
    buildGapTemplateWorkbook,
  } = ctx;

  // ── Weekly report ──────────────────────────────────────────────────

  app.get("/api/report/weeks", requirePermission("report_daily"), async (_req, res, next) => {
    try {
      const { weeks, defaultWeek } = await reportRepo.getWeekChoices();
      res.json({
        ok: true,
        weeks,
        default_week: defaultWeek,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/report/meta", requirePermission("report_daily"), async (req, res, next) => {
    try {
      const { week, weeks } = await reportRepo.resolveWeek(req.query.week);
      if (!week) {
        return res.status(404).json({ ok: false, message: "No report week available." });
      }
      const meta = await reportRepo.getReportMeta(week);
      res.json({
        ok: true,
        week,
        weeks,
        ...meta,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/report/rows", requirePermission("report_daily"), async (req, res, next) => {
    try {
      const { week } = await reportRepo.resolveWeek(req.query.week);
      if (!week) {
        return res.status(404).json({ ok: false, message: "No report week available." });
      }
      const page = parsePositiveInt(req.query.page, 1);
      const pageSize = Math.min(500, parsePositiveInt(req.query.pageSize, 50));
      const keyword = String(req.query.keyword || "");
      const fuzzy = String(req.query.fuzzy || "").trim() === "1";
      const payload = await reportRepo.getReportRows({ week, page, pageSize, keyword, fuzzy });
      res.json({
        ok: true,
        week,
        ...payload,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/report/export.xlsx", requirePermission("report_daily"), async (req, res, next) => {
    try {
      const { week } = await reportRepo.resolveWeek(req.query.week);
      if (!week) {
        return res.status(404).json({ ok: false, message: "No report week available." });
      }
      const meta = await reportRepo.getReportMeta(week);
      const rows = await reportRepo.getReportExportRows(week);

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([meta.group_headers, meta.column_headers, ...rows]);
      XLSX.utils.book_append_sheet(wb, ws, "周报主表");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true });

      const filename = `周报主表_${week.replace(/-/g, "")}_${stampNow()}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.send(buf);
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/report/gap-template.xlsx", requirePermission("report_daily"), async (req, res, next) => {
    try {
      const { week } = await reportRepo.resolveWeek(req.query.week);
      if (!week) {
        return res.status(404).json({ ok: false, message: "No report week available." });
      }
      const meta = await reportRepo.getReportMeta(week);
      const { wb } = buildGapTemplateWorkbook(week, meta.gap_summary || {});
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true });
      const filename = `缺口模板_${week.replace(/-/g, "")}_${stampNow()}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.send(buf);
    } catch (err) {
      next(err);
    }
  });

  // ── Daily report ───────────────────────────────────────────────────

  app.get(
    "/api/report-daily/dates",
    requireAnyPermission(["report_daily", "analysis"]),
    async (_req, res, next) => {
      try {
        const { salesDates, defaultSalesDate } = await reportRepo.getDailyDateChoices();
        res.json({
          ok: true,
          sales_dates: salesDates,
          default_sales_date: defaultSalesDate,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  app.get("/api/report-daily/meta", requirePermission("report_daily"), async (req, res, next) => {
    try {
      const dateFromRaw = String(req.query.dateFrom || "").trim();
      const dateToRaw = String(req.query.dateTo || "").trim();
      if (dateFromRaw || dateToRaw) {
        const { dateFrom, dateTo, salesDates } = await reportRepo.resolveDailyRange(dateFromRaw, dateToRaw);
        if (!dateFrom || !dateTo) {
          return res.status(404).json({ ok: false, message: "No daily report date available." });
        }
        const meta = await reportRepo.getDailyRangeMeta({ dateFrom, dateTo });
        return res.json({
          ok: true,
          date_from: dateFrom,
          date_to: dateTo,
          sales_dates: salesDates,
          ...meta,
        });
      }

      const { salesDate, salesDates } = await reportRepo.resolveDailyDate(req.query.salesDate);
      if (!salesDate) {
        return res.status(404).json({ ok: false, message: "No daily report date available." });
      }
      const meta = await reportRepo.getDailyMeta(salesDate);
      res.json({
        ok: true,
        sales_date: salesDate,
        sales_dates: salesDates,
        ...meta,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/report-daily/rows", requirePermission("report_daily"), async (req, res, next) => {
    try {
      const dateFromRaw = String(req.query.dateFrom || "").trim();
      const dateToRaw = String(req.query.dateTo || "").trim();
      const page = parsePositiveInt(req.query.page, 1);
      const pageSize = Math.min(500, parsePositiveInt(req.query.pageSize, 50));
      const keyword = String(req.query.keyword || "");
      const fuzzy = String(req.query.fuzzy || "").trim() === "1";

      if (dateFromRaw || dateToRaw) {
        const { dateFrom, dateTo } = await reportRepo.resolveDailyRange(dateFromRaw, dateToRaw);
        if (!dateFrom || !dateTo) {
          return res.status(404).json({ ok: false, message: "No daily report date available." });
        }
        const payload = await reportRepo.getDailyRowsRange({ dateFrom, dateTo, page, pageSize, keyword, fuzzy });
        return res.json({
          ok: true,
          date_from: dateFrom,
          date_to: dateTo,
          ...payload,
        });
      }

      const { salesDate } = await reportRepo.resolveDailyDate(req.query.salesDate);
      if (!salesDate) {
        return res.status(404).json({ ok: false, message: "No daily report date available." });
      }
      const payload = await reportRepo.getDailyRows({ salesDate, page, pageSize, keyword, fuzzy });
      res.json({
        ok: true,
        sales_date: salesDate,
        ...payload,
      });
    } catch (err) {
      next(err);
    }
  });

  async function sendDailyExport(req, res, next, options) {
    const bookType = String(options?.bookType || "xlsx");
    const ext = String(options?.ext || "xlsx");
    const contentType =
      String(options?.contentType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    try {
      const dateFromRaw = String(req.query.dateFrom || "").trim();
      const dateToRaw = String(req.query.dateTo || "").trim();

      if (dateFromRaw || dateToRaw) {
        const { dateFrom, dateTo } = await reportRepo.resolveDailyRange(dateFromRaw, dateToRaw);
        if (!dateFrom || !dateTo) {
          return res.status(404).json({ ok: false, message: "No daily report date available." });
        }
        const meta = await reportRepo.getDailyRangeMeta({ dateFrom, dateTo });
        const rows = await reportRepo.getDailyExportRowsRange({ dateFrom, dateTo });
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([meta.group_headers, meta.column_headers, ...rows]);
        XLSX.utils.book_append_sheet(wb, ws, "日报主表");
        const buf = XLSX.write(wb, { type: "buffer", bookType, compression: true });
        const filename = `日报主表_${dateFrom.replace(/-/g, "")}_${dateTo.replace(/-/g, "")}_${stampNow()}.${ext}`;
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        return res.send(buf);
      }

      const { salesDate } = await reportRepo.resolveDailyDate(req.query.salesDate);
      if (!salesDate) {
        return res.status(404).json({ ok: false, message: "No daily report date available." });
      }
      const meta = await reportRepo.getDailyMeta(salesDate);
      const rows = await reportRepo.getDailyExportRows(salesDate);

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([meta.group_headers, meta.column_headers, ...rows]);
      XLSX.utils.book_append_sheet(wb, ws, "日报主表");
      const buf = XLSX.write(wb, { type: "buffer", bookType, compression: true });

      const filename = `日报主表_${salesDate.replace(/-/g, "")}_${stampNow()}.${ext}`;
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      return res.send(buf);
    } catch (err) {
      next(err);
      return null;
    }
  }

  app.get("/api/report-daily/export.xlsx", requirePermission("report_daily"), async (req, res, next) => {
    await sendDailyExport(req, res, next, {
      bookType: "xlsx",
      ext: "xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  });

  app.get("/api/report-daily/export.xlsb", requirePermission("report_daily"), async (req, res, next) => {
    await sendDailyExport(req, res, next, {
      bookType: "xlsb",
      ext: "xlsb",
      contentType: "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
    });
  });
}

module.exports = { register };
