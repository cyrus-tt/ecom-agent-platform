"use strict";

/**
 * Permission matrix + permission-key normalization helpers.
 *
 * IMPORTANT: `AUTH_PERMISSION_MODULES` is computed at module load time and
 * depends on feature-module flags. Tests that need to flip those flags MUST
 * stub the env var BEFORE the first `require("./lib/auth/permissions")`
 * (or any caller that transitively requires it, e.g. `./lib/auth`).
 */

const dispatchModule = require("../../services/dispatch");
const toolsModule = require("../../services/tools");

const AUTH_PERMISSION_MODULES = [
  { key: "portal", label: "门户", route: "/", description: "登录后的首页与系统健康概览" },
  { key: "report_daily", label: "日报", route: "/report-daily", description: "日报主表与导出" },
  { key: "arrival", label: "新品", route: "/arrival", description: "到货、新品看板与跟进备注" },
  { key: "dashboard", label: "可视化", route: "/dashboard", description: "综合数据可视化看板" },
  { key: "channel_dashboard", label: "渠道", route: "/channel-dashboard", description: "渠道店铺看板" },
  { key: "analysis", label: "分析", route: "/analysis", description: "AI 经营分析与历史报告" },
  { key: "bi", label: "ChatBI", route: "/bi", description: "AI 生成 SQL + 拖拽透视表" },
  { key: "agent_dashboard", label: "操控台", route: "/agent-dashboard", description: "Agent 操控台：每日巡检简报、异常清单、活动时间线" },
  ...(dispatchModule.isEnabled() ? [dispatchModule.PERMISSION_MODULE] : []),
  ...(toolsModule.isEnabled() ? [toolsModule.PERMISSION_MODULE] : []),
];

const AUTH_PERMISSION_KEYS = AUTH_PERMISSION_MODULES.map((item) => item.key);
const AUTH_PERMISSION_SET = new Set(AUTH_PERMISSION_KEYS);

function normalizePermissionKeys(rawPermissions, fallbackPermissions = AUTH_PERMISSION_KEYS) {
  if (!Array.isArray(rawPermissions)) {
    return [...fallbackPermissions];
  }
  const next = [];
  rawPermissions.forEach((item) => {
    const key = String(item || "").trim();
    if (!AUTH_PERMISSION_SET.has(key) || next.includes(key)) {
      return;
    }
    next.push(key);
  });
  return next;
}

function resolvePreferredRouteForPermissions(permissions) {
  const permissionList = Array.isArray(permissions) ? permissions : [];
  for (const item of AUTH_PERMISSION_MODULES) {
    if (permissionList.includes(item.key)) {
      return item.route;
    }
  }
  return "/no-access";
}

function resolvePreferredRouteForAccount(account) {
  if (!account) {
    return "/no-access";
  }
  if (account.is_admin === true) {
    return "/";
  }
  return resolvePreferredRouteForPermissions(account.permissions);
}

function accountHasPermission(account, permissionKey) {
  if (!account) {
    return false;
  }
  if (account.is_admin === true) {
    return true;
  }
  return Array.isArray(account.permissions) && account.permissions.includes(permissionKey);
}

function accountHasAnyPermission(account, permissionKeys) {
  return (Array.isArray(permissionKeys) ? permissionKeys : []).some((item) => accountHasPermission(account, item));
}

function isRouteAllowedForAccount(account, pathname) {
  const routePath = String(pathname || "").trim() || "/";
  if (routePath === "/no-access") {
    return true;
  }
  if (routePath === "/") {
    return accountHasPermission(account, "portal");
  }
  if (routePath === "/report" || routePath.startsWith("/report-daily")) {
    return accountHasPermission(account, "report_daily");
  }
  if (routePath.startsWith("/outlet-assortment")) {
    return accountHasPermission(account, "report_daily");
  }
  if (routePath.startsWith("/arrival")) {
    return accountHasPermission(account, "arrival");
  }
  if (routePath.startsWith("/dashboard")) {
    return accountHasPermission(account, "dashboard");
  }
  if (routePath.startsWith("/channel-dashboard")) {
    return accountHasPermission(account, "channel_dashboard");
  }
  if (routePath.startsWith("/analysis")) {
    return accountHasPermission(account, "analysis");
  }
  if (routePath.startsWith("/bi")) {
    return accountHasPermission(account, "bi");
  }
  if (routePath.startsWith("/agent-dashboard")) {
    return accountHasPermission(account, "agent_dashboard");
  }
  if (routePath.startsWith("/dispatch")) {
    return accountHasPermission(account, "dispatch");
  }
  if (routePath.startsWith("/tools")) {
    return accountHasPermission(account, "tools");
  }
  if (routePath.startsWith("/admin/accounts")) {
    return account?.is_admin === true;
  }
  return true;
}

module.exports = {
  AUTH_PERMISSION_MODULES,
  AUTH_PERMISSION_KEYS,
  AUTH_PERMISSION_SET,
  normalizePermissionKeys,
  resolvePreferredRouteForPermissions,
  resolvePreferredRouteForAccount,
  accountHasPermission,
  accountHasAnyPermission,
  isRouteAllowedForAccount,
};
