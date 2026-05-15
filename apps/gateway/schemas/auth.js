"use strict";

const { z } = require("zod");

/**
 * POST /api/auth/login
 *
 * `next` is an opaque route path kept for post-login redirect. We do NOT
 * validate it here; the existing `normalizeNext` helper handles absolute-URL
 * rejection and length limits downstream.
 */
const loginBodySchema = z.object({
  username: z.string().trim().min(1, "username is required").max(128),
  password: z.string().min(1, "password is required").max(256),
  next: z.string().max(2048).optional(),
});

module.exports = { loginBodySchema };
