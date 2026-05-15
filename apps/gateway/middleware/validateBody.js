"use strict";

/**
 * validateBody(schema)
 *
 * Express middleware factory. Given a zod schema, parse req.body.
 * On success, replaces req.body with the parsed/coerced value so the
 * handler sees a fully typed, whitelisted payload.
 *
 * On failure, responds 400 with a structured error:
 *   { ok: false, message, issues: [{ path: "...", message: "..." }] }
 *
 * Design notes:
 *   - Uses safeParse instead of parse to avoid throwing inside middleware.
 *   - The handler receives res.locals.validatedBody as well, in case a
 *     handler wants to keep both the raw and validated bodies visible.
 *   - Replaces req.body (the express convention), because the extra
 *     defensive coercions most handlers currently do become redundant once
 *     validation is in place.
 */

function validateBody(schema) {
  if (!schema || typeof schema.safeParse !== "function") {
    throw new Error("validateBody requires a zod schema");
  }
  return function (req, res, next) {
    const incoming = req.body && typeof req.body === "object" ? req.body : {};
    const result = schema.safeParse(incoming);
    if (!result.success) {
      const issues = (result.error?.issues || []).map((issue) => ({
        path: Array.isArray(issue.path) ? issue.path.join(".") : String(issue.path || ""),
        message: issue.message,
      }));
      const summary = issues.length
        ? issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ")
        : "invalid payload";
      return res.status(400).json({
        ok: false,
        message: `invalid input: ${summary}`,
        issues,
      });
    }
    req.body = result.data;
    res.locals = res.locals || {};
    res.locals.validatedBody = result.data;
    return next();
  };
}

module.exports = { validateBody };
