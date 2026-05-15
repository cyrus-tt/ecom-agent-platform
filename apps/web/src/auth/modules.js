export const NO_ACCESS_ROUTE = "/no-access";
export const ADMIN_ACCOUNTS_ROUTE = "/admin/accounts";
export const ADMIN_USAGE_ROUTE = "/admin/usage";

export const APP_MODULES = [
  {
    key: "portal",
    label: "门户",
    path: "/",
    menuKey: "/",
    description: "登录后的首页与系统健康概览",
  },
  {
    key: "report_daily",
    label: "日报",
    path: "/report-daily",
    menuKey: "/report-daily",
    description: "日报主表与导出",
  },
  {
    key: "arrival",
    label: "新品",
    path: "/arrival",
    menuKey: "/arrival",
    description: "到货、新品看板与跟进备注",
  },
  {
    key: "dashboard",
    label: "可视化",
    path: "/dashboard",
    menuKey: "/dashboard",
    description: "综合数据可视化看板",
  },
  {
    key: "channel_dashboard",
    label: "渠道",
    path: "/channel-dashboard",
    menuKey: "/channel-dashboard",
    description: "渠道店铺看板",
  },
  {
    key: "analysis",
    label: "分析",
    path: "/analysis",
    menuKey: "/analysis",
    description: "AI 经营分析与历史报告",
  },
  {
    key: "bi",
    label: "ChatBI",
    path: "/bi",
    menuKey: "/bi",
    description: "AI 生成 SQL + 拖拽透视表",
  },
  {
    key: "dispatch",
    label: "调拨",
    path: "/dispatch",
    menuKey: "/dispatch",
    description: "调拨 Agent:清洗需求、计算调拨方案、生成导入模板",
  },
  {
    key: "tools",
    label: "小工具",
    path: "/tools",
    menuKey: "/tools",
    description: "本地 Excel 小工具：移仓、洗码、调拨模板、断码预警、缺货处理",
  },
];

export function hasModulePermission(auth, moduleKey) {
  if (!auth) {
    return false;
  }
  if (auth.isAdmin) {
    return true;
  }
  return Array.isArray(auth.permissions) && auth.permissions.includes(moduleKey);
}

export function getPreferredRoute(auth) {
  const preferred = String(auth?.preferredRoute || "").trim();
  return preferred || NO_ACCESS_ROUTE;
}

export function resolveSelectedMenu(pathname) {
  if (pathname === ADMIN_ACCOUNTS_ROUTE || pathname.startsWith(`${ADMIN_ACCOUNTS_ROUTE}/`)) {
    return ADMIN_ACCOUNTS_ROUTE;
  }
  const matched = APP_MODULES.find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`));
  return matched?.menuKey || "";
}

export function isRouteAllowed(auth, pathname) {
  const targetPath = String(pathname || "").trim() || "/";
  if (targetPath === NO_ACCESS_ROUTE) {
    return true;
  }
  if (targetPath === ADMIN_ACCOUNTS_ROUTE || targetPath.startsWith(`${ADMIN_ACCOUNTS_ROUTE}/`)) {
    return auth?.isAdmin === true;
  }
  const matched = APP_MODULES.find((item) => targetPath === item.path || targetPath.startsWith(`${item.path}/`));
  if (!matched) {
    return true;
  }
  return hasModulePermission(auth, matched.key);
}
