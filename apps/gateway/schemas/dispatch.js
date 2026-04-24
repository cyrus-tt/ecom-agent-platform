"use strict";

const { z } = require("zod");

/**
 * POST /api/dispatch/public/confirm
 *
 * Public (token-authorized) endpoint used by the dingtalk recipient to
 * confirm / override a dispatch task. Token may come via query string or
 * body; zod only covers body.responses shape here — token validation is
 * done separately in the handler (it's part of auth, not payload).
 *
 * responses keyed by SKU, each value is a decision string chosen from
 * an orchestrator-maintained whitelist. We allow any string here and
 * defer semantic validation to orchestrator.submitConfirm.
 */
const publicConfirmBodySchema = z.object({
  token: z.string().max(128).optional(),
  responses: z.record(z.string().max(64), z.string().max(64)).optional().default({}),
});

module.exports = { publicConfirmBodySchema };
