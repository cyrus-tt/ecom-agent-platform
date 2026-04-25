#!/usr/bin/env node
"use strict";

/**
 * build-openapi.js — Generate `openapi.generated.yaml` from existing zod schemas.
 *
 * Why this exists (read first!):
 *   The hand-maintained `openapi.yaml` (PR10) covers ~11 endpoints and is
 *   trivially easy to forget to update when a new zod schema lands. This
 *   script removes the duplication for the *body schemas* that already exist
 *   in `apps/gateway/schemas/*.js`, so adding a new endpoint with a zod body
 *   schema is one place: write the schema, register the path here, run the
 *   build. The hand-written `openapi.yaml` stays as a fallback (default
 *   served by `/api/docs`) until we have full coverage.
 *
 * Usage:
 *   node apps/gateway/scripts/build-openapi.js
 *   # or, from repo root:  npm run build:openapi
 *
 * Output:
 *   apps/gateway/openapi.generated.yaml
 *
 * Switch served spec at runtime: `/api/docs?source=generated` (see routes/docs.js).
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { z } = require("zod");
const {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} = require("@asteasolutions/zod-to-openapi");

extendZodWithOpenApi(z);

// ---- import existing zod schemas (no rewrite required) ---------------------

const {
  createAccountBodySchema,
  updatePermissionsBodySchema,
  updatePasswordBodySchema,
  deepseekKeyBodySchema,
} = require("../schemas/admin");
const { runBodySchema } = require("../schemas/agent");
const { loginBodySchema } = require("../schemas/auth");
const { publicConfirmBodySchema } = require("../schemas/dispatch");

// ---- shared response schemas (kept minimal; mirrors openapi.yaml) ----------

const errorSchema = z
  .object({
    ok: z.boolean(),
    message: z.string().optional(),
    issues: z
      .array(
        z.object({
          path: z.string(),
          message: z.string(),
        })
      )
      .optional(),
  })
  .openapi("Error", {
    description: "Standard failure envelope used across the gateway.",
  });

const okSchema = z
  .object({ ok: z.boolean() })
  .openapi("Ok", { description: "Generic success envelope." });

const loginResponseSchema = z
  .object({
    ok: z.boolean(),
    account_id: z.string().optional(),
    username: z.string().optional(),
    name: z.string().optional(),
    is_admin: z.boolean().optional(),
    permissions: z.array(z.string()).optional(),
    preferred_route: z.string().optional(),
    expires_at: z.string().optional(),
    next: z.string().optional(),
  })
  .openapi("LoginResponse");

// ---- build registry --------------------------------------------------------

const registry = new OpenAPIRegistry();

const sessionAuth = registry.registerComponent("securitySchemes", "sessionAuth", {
  type: "apiKey",
  in: "cookie",
  name: "anta_sid",
});

// Re-register every imported zod schema by name so $ref works in paths.
registry.register("LoginRequest", loginBodySchema);
registry.register("AgentRunRequest", runBodySchema);
registry.register("CreateAccountRequest", createAccountBodySchema);
registry.register("UpdatePermissionsRequest", updatePermissionsBodySchema);
registry.register("UpdatePasswordRequest", updatePasswordBodySchema);
registry.register("DeepseekKeyRequest", deepseekKeyBodySchema);
registry.register("DispatchPublicConfirmRequest", publicConfirmBodySchema);

// ---- path registrations ----------------------------------------------------
// Each registerPath corresponds to a real route handler.

registry.registerPath({
  method: "post",
  path: "/api/auth/login",
  summary: "Exchange credentials for a session cookie",
  tags: ["auth"],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: loginBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Logged in; sets session cookie.",
      content: { "application/json": { schema: loginResponseSchema } },
    },
    400: {
      description: "Validation error.",
      content: { "application/json": { schema: errorSchema } },
    },
    401: {
      description: "Wrong credentials.",
      content: { "application/json": { schema: errorSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/agent/run",
  summary: "Generate an AI analysis report.",
  tags: ["agent"],
  security: [{ [sessionAuth.name]: [] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: runBodySchema } },
    },
  },
  responses: {
    200: { description: "Report generated or no-data notice." },
    400: {
      description: "Validation error.",
      content: { "application/json": { schema: errorSchema } },
    },
    502: { description: "Upstream AI service error." },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/admin/accounts",
  summary: "Create a managed (non-primary) account.",
  tags: ["admin"],
  security: [{ [sessionAuth.name]: [] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createAccountBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Account created.",
      content: { "application/json": { schema: okSchema } },
    },
    400: {
      description: "Validation error.",
      content: { "application/json": { schema: errorSchema } },
    },
    403: { description: "Not admin." },
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/admin/accounts/{accountId}/permissions",
  summary: "Overwrite an account's non-admin permissions.",
  tags: ["admin"],
  security: [{ [sessionAuth.name]: [] }],
  request: {
    params: z.object({ accountId: z.string() }),
    body: {
      required: true,
      content: { "application/json": { schema: updatePermissionsBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Permissions updated.",
      content: { "application/json": { schema: okSchema } },
    },
    400: {
      description: "Validation error.",
      content: { "application/json": { schema: errorSchema } },
    },
    403: { description: "Not admin." },
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/admin/accounts/{accountId}/password",
  summary: "Admin resets another account's password.",
  tags: ["admin"],
  security: [{ [sessionAuth.name]: [] }],
  request: {
    params: z.object({ accountId: z.string() }),
    body: {
      required: true,
      content: { "application/json": { schema: updatePasswordBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Password updated.",
      content: { "application/json": { schema: okSchema } },
    },
    400: {
      description: "Validation error.",
      content: { "application/json": { schema: errorSchema } },
    },
    403: { description: "Not admin." },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/settings/ai/deepseek-key",
  summary: "Update the DeepSeek API key (admin only).",
  tags: ["admin", "ai-settings"],
  security: [{ [sessionAuth.name]: [] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: deepseekKeyBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Key saved.",
      content: { "application/json": { schema: okSchema } },
    },
    400: {
      description: "Validation error.",
      content: { "application/json": { schema: errorSchema } },
    },
    403: { description: "Not admin." },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/dispatch/public/confirm",
  summary: "Public confirm endpoint for dispatch (token-authorized).",
  description:
    "Token can come via query string `?token=` or body. Body schema documented here covers `responses` map.",
  tags: ["dispatch", "public"],
  request: {
    query: z.object({ token: z.string().optional() }),
    body: {
      required: true,
      content: { "application/json": { schema: publicConfirmBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Confirmation accepted.",
      content: { "application/json": { schema: okSchema } },
    },
    400: {
      description: "Validation error.",
      content: { "application/json": { schema: errorSchema } },
    },
    401: { description: "Bad / expired token." },
  },
});

// ---- generate doc ----------------------------------------------------------

function build() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  const doc = generator.generateDocument({
    openapi: "3.0.3",
    info: {
      title: "ecom-agent-platform Gateway API (generated)",
      version: "1.0.0",
      description:
        "Auto-generated from zod schemas in apps/gateway/schemas/*. " +
        "Run `npm run build:openapi` to refresh. The hand-written " +
        "openapi.yaml remains the default served by /api/docs; pass " +
        "?source=generated to view this doc.",
    },
    servers: [
      { url: "http://localhost:3000", description: "Local dev / current production gateway." },
    ],
  });
  return doc;
}

function writeYaml(doc, outFile) {
  const text =
    "# AUTO-GENERATED — do not edit by hand. Run `npm run build:openapi`.\n" +
    yaml.dump(doc, { noRefs: true, sortKeys: false });
  fs.writeFileSync(outFile, text, "utf8");
}

function main() {
  const out = path.resolve(__dirname, "..", "openapi.generated.yaml");
  const doc = build();
  writeYaml(doc, out);
  const pathCount = Object.keys(doc.paths || {}).length;
  // eslint-disable-next-line no-console
  console.log(`build-openapi: wrote ${out} (${pathCount} paths)`);
}

if (require.main === module) {
  main();
}

module.exports = { build, writeYaml };
