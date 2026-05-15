"use strict";

const { z } = require("zod");

const PERMISSION_KEY = z.string().trim().min(1).max(32);

/**
 * POST /api/admin/accounts
 *
 * Creates a managed (non-primary) account. Password gets bcrypted via PR5
 * flow when ENABLE_BCRYPT is on.
 */
const createAccountBodySchema = z.object({
  name: z.string().trim().min(1, "name is required").max(64),
  password: z.string().min(1, "password is required").max(128),
  permissions: z.array(PERMISSION_KEY).max(32).optional().default([]),
});

/**
 * PATCH /api/admin/accounts/:accountId/permissions
 *
 * Overwrites the non-admin permissions list for an account.
 */
const updatePermissionsBodySchema = z.object({
  permissions: z.array(PERMISSION_KEY).max(32),
});

/**
 * PATCH /api/admin/accounts/:accountId/password
 *
 * Admin resets another account's password.
 */
const updatePasswordBodySchema = z.object({
  password: z.string().min(1, "password is required").max(128),
});

/**
 * POST /api/settings/ai/deepseek-key
 */
const deepseekKeyBodySchema = z.object({
  api_key: z.string().min(1, "api_key is required").max(256),
});

module.exports = {
  createAccountBodySchema,
  updatePermissionsBodySchema,
  updatePasswordBodySchema,
  deepseekKeyBodySchema,
};
