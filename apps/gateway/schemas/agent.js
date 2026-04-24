"use strict";

const { z } = require("zod");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/agent/run
 *
 * Shape documented in the existing AnalysisPage client. Validation is
 * tolerant on skill_id/prompt_text because downstream `resolveSkillPrompt`
 * already picks safe defaults.
 */
const runBodySchema = z.object({
  period_type: z
    .string()
    .trim()
    .min(1, "period_type is required")
    .max(32),
  start_date: z
    .string()
    .trim()
    .regex(ISO_DATE, "start_date must be YYYY-MM-DD")
    .optional()
    .default(""),
  end_date: z
    .string()
    .trim()
    .regex(ISO_DATE, "end_date must be YYYY-MM-DD")
    .optional()
    .default(""),
  skill_id: z.string().trim().max(64).optional().default(""),
  prompt_text: z.string().max(4096).optional().default(""),
});

module.exports = { runBodySchema };
