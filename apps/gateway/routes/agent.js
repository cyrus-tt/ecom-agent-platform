"use strict";

/**
 * Analysis agent endpoints.
 *
 * Exports:
 *   GET  /api/agent/skills       — list available analysis skills
 *   GET  /api/agent/context      — period metrics payload (fixture-aware)
 *   POST /api/agent/run          — run analysis (calls DeepSeek, saves report)
 *   GET  /api/agent/reports      — paginated history of saved reports
 *   GET  /api/agent/reports/:id  — fetch single saved report
 */

const { validateBody } = require("../middleware/validateBody");
const { runBodySchema } = require("../schemas/agent");
const { requirePermission } = require("../middleware/requirePermission");
const { requireAgentContextAccess } = require("../middleware/requireAgentContextAccess");

function register(app, ctx) {
  const {
    express,
    agentSkills,
    agentService,
    analysisContextProvider,
    metricsService,
    reportRepo,
    parsePositiveInt,
    normalizeAgentPeriodType,
    aiReportLimiter = (_req, _res, next) => next(),
  } = ctx;

  app.get("/api/agent/skills", requirePermission("analysis"), (_req, res) => {
    res.json({
      ok: true,
      default_skill_id: agentSkills.DEFAULT_SKILL_ID,
      items: agentSkills.listSkills(),
    });
  });

  app.get("/api/agent/context", requireAgentContextAccess, async (req, res, next) => {
    try {
      const payload = await analysisContextProvider.getContext({
        period_type: req.query.period_type,
        start_date: req.query.start_date,
        end_date: req.query.end_date,
      });
      return res.json(payload);
    } catch (err) {
      next(err);
      return null;
    }
  });

  app.post(
    "/api/agent/run",
    requirePermission("analysis"),
    express.json({ limit: "1mb" }),
    aiReportLimiter,
    validateBody(runBodySchema),
    async (req, res, next) => {
      try {
        res.setTimeout(95000);
        const body = req.body;
        const periodType = normalizeAgentPeriodType(body.period_type);
        const startDate = body.start_date || "";
        const endDate = body.end_date || "";
        const skillId = body.skill_id || agentSkills.DEFAULT_SKILL_ID;
        const promptText = body.prompt_text || "";
        const promptConfig = agentSkills.resolveSkillPrompt(skillId, promptText);

        const metrics = await metricsService.calculateMetrics({
          periodType,
          startDate,
          endDate,
        });
        if (!metrics.has_data) {
          return res.status(200).json({
            ok: false,
            message: "所选周期没有可用销售数据，请调整日期后重试。",
          });
        }

        let reportMd = "";
        let status = "success";
        let errorMessage = "";
        try {
          const aiResult = await agentService.generateAnalysisReport({
            metrics,
            skillId: promptConfig.skill_id,
            promptText: promptConfig.prompt_text,
          });
          reportMd = aiResult.report_md;
          promptConfig.skill_id = aiResult.skill_id || promptConfig.skill_id;
          promptConfig.skill_name = aiResult.skill_name || promptConfig.skill_name;
          promptConfig.prompt_text = aiResult.prompt_text || promptConfig.prompt_text;
        } catch (err) {
          status = "error";
          errorMessage = String(err && err.message ? err.message : err);
          reportMd = [
            "## 报告生成失败",
            "",
            "本次调用 AI 服务失败，请检查密钥配置或稍后重试。",
            "",
            `错误信息：${errorMessage}`,
          ].join("\n");
        }

        const saved = await reportRepo.createAnalysisReport({
          periodType: metrics.period.type,
          periodStart: metrics.period.start,
          periodEnd: metrics.period.end,
          skillId: promptConfig.skill_id,
          skillName: promptConfig.skill_name,
          promptText: promptConfig.prompt_text,
          metricsJson: metrics,
          reportMd,
          status,
          errorMsg: status === "error" ? errorMessage : "",
        });

        if (status === "error") {
          return res.status(502).json({
            ok: false,
            message: "AI 报告生成失败，错误信息已记录。",
            report_id: Number(saved?.id || 0),
            skill_id: promptConfig.skill_id,
            skill_name: promptConfig.skill_name,
            prompt_text: promptConfig.prompt_text,
            created_at: saved?.created_at ? new Date(saved.created_at).toISOString() : new Date().toISOString(),
          });
        }

        return res.json({
          ok: true,
          report_id: Number(saved?.id || 0),
          report_md: reportMd,
          skill_id: promptConfig.skill_id,
          skill_name: promptConfig.skill_name,
          prompt_text: promptConfig.prompt_text,
          metrics_summary: metrics.summary,
          created_at: saved?.created_at ? new Date(saved.created_at).toISOString() : new Date().toISOString(),
        });
      } catch (err) {
        next(err);
        return null;
      }
    }
  );

  app.get("/api/agent/reports", requirePermission("analysis"), async (req, res, next) => {
    try {
      const page = parsePositiveInt(req.query.page, 1);
      const pageSize = Math.min(100, parsePositiveInt(req.query.pageSize, 10));
      const payload = await reportRepo.listAnalysisReports({ page, pageSize });
      res.json({
        ok: true,
        ...payload,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/agent/reports/:id", requirePermission("analysis"), async (req, res, next) => {
    try {
      const report = await reportRepo.getAnalysisReportById(req.params.id);
      if (!report) {
        return res.status(404).json({ ok: false, message: "report not found" });
      }
      return res.json({
        ok: true,
        report,
      });
    } catch (err) {
      next(err);
      return null;
    }
  });
}

module.exports = { register };
