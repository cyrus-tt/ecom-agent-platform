import { describe, it, expect } from "vitest";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const yaml = require("js-yaml");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "build-openapi.js");
const OUT = path.join(ROOT, "openapi.generated.yaml");

describe("build-openapi script", () => {
  it("generates a valid OpenAPI yaml with at least 5 paths", () => {
    // Run the build deterministically, capturing stdout for diagnostics.
    const stdout = execFileSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(stdout).toMatch(/build-openapi: wrote/);

    expect(fs.existsSync(OUT)).toBe(true);
    const raw = fs.readFileSync(OUT, "utf8");
    expect(raw).toMatch(/^# AUTO-GENERATED/);

    const doc = yaml.load(raw);
    expect(doc).toBeTruthy();
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.info && doc.info.title).toMatch(/Gateway API/);

    const paths = Object.keys(doc.paths || {});
    expect(paths.length).toBeGreaterThanOrEqual(5);

    // Spot-check that key endpoints from real route handlers are present so a
    // future drift (someone deletes a registerPath) is caught here.
    expect(paths).toContain("/api/auth/login");
    expect(paths).toContain("/api/agent/run");
    expect(paths).toContain("/api/admin/accounts");

    // Schemas: at minimum the request schemas we registered should round-trip.
    const schemas = Object.keys((doc.components && doc.components.schemas) || {});
    expect(schemas).toContain("LoginRequest");
    expect(schemas).toContain("AgentRunRequest");
    expect(schemas).toContain("CreateAccountRequest");

    // Required-fields sanity: LoginRequest must require username + password.
    const login = doc.components.schemas.LoginRequest;
    expect(login.required).toEqual(expect.arrayContaining(["username", "password"]));

    // Security scheme registered (sessionAuth cookie).
    const secs = (doc.components && doc.components.securitySchemes) || {};
    expect(secs.sessionAuth).toMatchObject({
      type: "apiKey",
      in: "cookie",
      name: "anta_sid",
    });
  });
});
