"use strict";

const { z } = require("zod");
const passwordPolicy = require("../lib/passwordPolicy");

const PERMISSION_KEY = z.string().trim().min(1).max(32);

/**
 * 密码强度 refinement —— 复用在创建账号与重置密码两处。
 *
 * 设计要点：
 *   - 保留外层 `.min(1).max(128)` 作为 zod 原生的 schema 契约（文档/OpenAPI 生成器可见）
 *   - superRefine 负责策略维度（长度下限、大小写、数字、黑名单）
 *   - policy 关闭时 `validate()` 仅做安全上限，super refinement 照样不会 addIssue
 */
function applyPasswordPolicy(val, ctx) {
  const result = passwordPolicy.validate(val);
  if (result.ok) return;
  for (const message of result.reasons) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  }
}

/**
 * POST /api/admin/accounts
 */
const createAccountBodySchema = z.object({
  name: z.string().trim().min(1, "name is required").max(64),
  password: z
    .string()
    .min(1, "password is required")
    .max(128)
    .superRefine(applyPasswordPolicy),
  permissions: z.array(PERMISSION_KEY).max(32).optional().default([]),
});

/**
 * PATCH /api/admin/accounts/:accountId/permissions
 */
const updatePermissionsBodySchema = z.object({
  permissions: z.array(PERMISSION_KEY).max(32),
});

/**
 * PATCH /api/admin/accounts/:accountId/password
 */
const updatePasswordBodySchema = z.object({
  password: z
    .string()
    .min(1, "password is required")
    .max(128)
    .superRefine(applyPasswordPolicy),
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
