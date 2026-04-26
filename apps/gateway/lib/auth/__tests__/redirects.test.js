import { describe, it, expect } from "vitest";

// eslint-disable-next-line import/first
const {
  normalizeNext,
  isPublicPath,
  resolvePostLoginRoute,
} = require("../redirects");

describe("lib/auth/redirects", () => {
  describe("normalizeNext", () => {
    it("returns / on empty input", () => {
      expect(normalizeNext("")).toBe("/");
      expect(normalizeNext(null)).toBe("/");
      expect(normalizeNext(undefined)).toBe("/");
    });

    it("rejects // (open redirect attempt)", () => {
      expect(normalizeNext("//evil.com/path")).toBe("/");
    });

    it("rejects schemes/relative-without-leading-slash", () => {
      expect(normalizeNext("https://evil.com")).toBe("/");
      expect(normalizeNext("foo/bar")).toBe("/");
    });

    it("preserves valid same-origin paths", () => {
      expect(normalizeNext("/dashboard")).toBe("/dashboard");
      expect(normalizeNext("/report-daily?week=2024-W01")).toBe("/report-daily?week=2024-W01");
    });
  });

  describe("isPublicPath", () => {
    it("login pages are public", () => {
      expect(isPublicPath("/login")).toBe(true);
      expect(isPublicPath("/api/auth/login")).toBe(true);
    });

    it("health probes are public", () => {
      expect(isPublicPath("/healthz")).toBe(true);
      expect(isPublicPath("/readyz")).toBe(true);
    });

    it("dispatch confirm pages are public", () => {
      expect(isPublicPath("/dispatch/confirm/abc")).toBe(true);
      expect(isPublicPath("/api/dispatch/public/preview")).toBe(true);
      expect(isPublicPath("/api/dispatch/public/confirm")).toBe(true);
    });

    it("admin pages are not public", () => {
      expect(isPublicPath("/admin/accounts")).toBe(false);
      expect(isPublicPath("/api/admin/accounts")).toBe(false);
    });

    it("the dashboard is not public", () => {
      expect(isPublicPath("/dashboard")).toBe(false);
    });
  });

  describe("resolvePostLoginRoute", () => {
    const adminUser = { is_admin: true, permissions: [] };
    const reportUser = { is_admin: false, permissions: ["report_daily"] };

    it("admin lands at the requested next when allowed", () => {
      expect(resolvePostLoginRoute(adminUser, "/dashboard")).toBe("/dashboard");
    });

    it("admin lands at / when next is missing", () => {
      expect(resolvePostLoginRoute(adminUser, "")).toBe("/");
    });

    it("non-admin denied next falls back to preferred route", () => {
      expect(resolvePostLoginRoute(reportUser, "/dashboard")).toBe("/report-daily");
    });

    it("/login or /logout next is rewritten to preferred route", () => {
      expect(resolvePostLoginRoute(adminUser, "/login")).toBe("/");
      expect(resolvePostLoginRoute(reportUser, "/logout")).toBe("/report-daily");
    });

    it("non-admin allowed next is preserved", () => {
      expect(resolvePostLoginRoute(reportUser, "/report-daily")).toBe("/report-daily");
    });
  });
});
