"use strict";

function isEnabled() {
  const raw = String(process.env.TOOLS_MODULE_ENABLED || "").trim().toLowerCase();
  if (!raw) return true;
  return !(raw === "false" || raw === "0" || raw === "no" || raw === "off");
}

const PERMISSION_MODULE = {
  key: "tools",
  label: "小工具",
  route: "/tools",
  description: "本地 Excel 小工具：移仓、洗码、调拨模板、断码预警、缺货处理",
};

module.exports = { isEnabled, PERMISSION_MODULE };

