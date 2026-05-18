/**
 * Unit tests for lib/auth/permissions.
 *
 * NOTE: AUTH_PERMISSION_MODULES is computed at module load time and depends
 * on `process.env.DISPATCH_AGENT_ENABLED`. vitest.config.js sets it to "true"
 * before any require, so the dispatch permission row is present below.
 */

import { describe, it, expect } from "vitest";

// eslint-disable-next-line import/first
const {
  AUTH_PERMISSION_MODULES,
  AUTH_PERMISSION_KEYS,
  normalizePermissionKeys,
  resolvePreferredRouteForPermissions,
  resolvePreferredRouteForAccount,
  accountHasPermission,
  accountHasAnyPermission,
  isRouteAllowedForAccount,
} = require("../permissions");

describe("lib/auth/permissions", () => {
  it("AUTH_PERMISSION_KEYS includes all known modules and dispatch when env is set", () => {
    expect(AUTH_PERMISSION_KEYS).toEqual(expect.arrayContaining([
      "portal", "report_daily", "arrival", "dashboard", "channel_dashboard", "analysis",
    ]));
    expect(AUTH_PERMISSION_MODULES.length).toBe(AUTH_PERMISSION_KEYS.length);
    // dispatch is enabled in vitest env
    expect(AUTH_PERMISSION_KEYS).toContain("dispatch");
  });

  describe("normalizePermissionKeys", () => {
    it("returns a copy of fallback when input is not an array", () => {
      const result = normalizePermissionKeys(undefined);
      expect(result).toEqual(AUTH_PERMISSION_KEYS);
      expect(result).not.toBe(AUTH_PERMISSION_KEYS);
    });

    it("filters unknown permission keys", () => {
      const result = normalizePermissionKeys(["portal", "totally_made_up", "report_daily"]);
      expect(result).toEqual(["portal", "report_daily"]);
    });

    it("dedupes repeated entries while preserving first occurrence", () => {
      const result = normalizePermissionKeys(["portal", "portal", "arrival", "portal"]);
      expect(result).toEqual(["portal", "arrival"]);
    });

    it("trims string entries", () => {
      const result = normalizePermissionKeys(["  portal  ", " arrival "]);
      expect(result).toEqual(["portal", "arrival"]);
    });

    it("uses an explicit fallback when input is not an array", () => {
      const result = normalizePermissionKeys(null, ["portal"]);
      expect(result).toEqual(["portal"]);
    });
  });

  describe("accountHasPermission", () => {
    it("returns false for null/undefined account", () => {
      expect(accountHasPermission(null, "portal")).toBe(false);
      expect(accountHasPermission(undefined, "portal")).toBe(false);
    });

    it("returns true for admin regardless of permission key", () => {
      expect(accountHasPermission({ is_admin: true, permissions: [] }, "anything")).toBe(true);
    });

    it("returns true when the explicit permission is in the array", () => {
      expect(accountHasPermission({ permissions: ["report_daily"] }, "report_daily")).toBe(true);
    });

    it("returns false when the permission is missing", () => {
      expect(accountHasPermission({ permissions: ["portal"] }, "report_daily")).toBe(false);
    });
  });

  describe("accountHasAnyPermission", () => {
    it("returns true if any key matches", () => {
      expect(accountHasAnyPermission({ permissions: ["arrival"] }, ["report_daily", "arrival"])).toBe(true);
    });

    it("returns false when nothing matches", () => {
      expect(accountHasAnyPermission({ permissions: ["portal"] }, ["report_daily", "arrival"])).toBe(false);
    });

    it("handles non-array argument as empty", () => {
      expect(accountHasAnyPermission({ permissions: ["portal"] }, null)).toBe(false);
    });
  });

  describe("resolvePreferredRouteForPermissions", () => {
    it("returns the first matching route in module order", () => {
      // arrival comes after report_daily in the module order
      expect(resolvePreferredRouteForPermissions(["arrival", "report_daily"])).toBe("/report-daily");
    });

    it("falls back to /no-access when nothing matches", () => {
      expect(resolvePreferredRouteForPermissions([])).toBe("/no-access");
      expect(resolvePreferredRouteForPermissions(["unknown"])).toBe("/no-access");
    });
  });

  describe("resolvePreferredRouteForAccount", () => {
    it("admin always lands at /", () => {
      expect(resolvePreferredRouteForAccount({ is_admin: true, permissions: [] })).toBe("/");
    });

    it("non-admin lands at the first allowed route", () => {
      expect(resolvePreferredRouteForAccount({ is_admin: false, permissions: ["arrival"] })).toBe("/arrival");
    });

    it("null account → /no-access", () => {
      expect(resolvePreferredRouteForAccount(null)).toBe("/no-access");
    });
  });

  describe("isRouteAllowedForAccount", () => {
    const userArrival = { permissions: ["arrival"] };
    const userReport = { permissions: ["report_daily"] };
    const adminUser = { is_admin: true, permissions: [] };

    it("/no-access is always allowed", () => {
      expect(isRouteAllowedForAccount(null, "/no-access")).toBe(true);
    });

    it("/ requires portal permission", () => {
      expect(isRouteAllowedForAccount({ permissions: ["portal"] }, "/")).toBe(true);
      expect(isRouteAllowedForAccount(userArrival, "/")).toBe(false);
    });

    it("/report-daily requires report_daily", () => {
      expect(isRouteAllowedForAccount(userReport, "/report-daily")).toBe(true);
      expect(isRouteAllowedForAccount(userArrival, "/report-daily")).toBe(false);
    });

    it("/outlet-assortment requires report_daily", () => {
      expect(isRouteAllowedForAccount(userReport, "/outlet-assortment")).toBe(true);
      expect(isRouteAllowedForAccount(userArrival, "/outlet-assortment")).toBe(false);
    });

    it("/arrival/anything requires arrival", () => {
      expect(isRouteAllowedForAccount(userArrival, "/arrival/foo")).toBe(true);
      expect(isRouteAllowedForAccount(userReport, "/arrival/foo")).toBe(false);
    });

    it("/admin/accounts requires is_admin", () => {
      expect(isRouteAllowedForAccount(adminUser, "/admin/accounts")).toBe(true);
      expect(isRouteAllowedForAccount(userReport, "/admin/accounts")).toBe(false);
    });

    it("unknown routes default to allowed (handled elsewhere)", () => {
      expect(isRouteAllowedForAccount(userReport, "/some-other-thing")).toBe(true);
    });
  });
});
