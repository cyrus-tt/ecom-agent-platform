"use strict";

const { requirePermission } = require("../middleware/requirePermission");
const { buildBuffer, reportSchema } = require("../lib/report/excelBuilder");

function register(app, ctx) {
  const {
    express,
    excelExportLimiter = (_req, _res, next) => next(),
  } = ctx;

  app.post(
    "/api/report/export",
    requirePermission("analysis"),
    express.json({ limit: "5mb" }),
    excelExportLimiter,
    async (req, res, next) => {
      try {
        const parsed = reportSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            ok: false,
            message: parsed.error.issues?.[0]?.message || "Invalid report schema",
            errors: parsed.error.issues,
          });
        }

        const buf = await buildBuffer(parsed.data);

        const safeTitle = String(parsed.data.title || "report")
          .replace(/[^\w一-鿿\- ]/g, "")
          .trim()
          .slice(0, 80);
        const filename = `${safeTitle || "report"}.xlsx`;

        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
        );
        return res.send(Buffer.from(buf));
      } catch (err) {
        next(err);
        return null;
      }
    }
  );
}

module.exports = { register };
