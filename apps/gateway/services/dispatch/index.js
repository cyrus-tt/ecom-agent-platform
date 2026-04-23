"use strict";

const routes = require("./routes");

function isEnabled() {
  const raw = String(process.env.DISPATCH_AGENT_ENABLED || "").trim().toLowerCase();
  if (!raw) {
    // Dispatch is now a built-in SaaS module and defaults to enabled.
    return true;
  }
  return !(raw === "false" || raw === "0" || raw === "no" || raw === "off");
}

function tryRegister(app, ctx) {
  if (!isEnabled()) {
    console.log("[dispatch] DISPATCH_AGENT_ENABLED=false, 已跳过调拨 Agent 注册");
    return { enabled: false };
  }
  try {
    routes.registerRoutes(app, ctx);
    console.log("[dispatch] 调拨 Agent 路由已注册");
    return { enabled: true };
  } catch (err) {
    console.error("[dispatch] 注册失败(现有功能不受影响):", err.message);
    return { enabled: false, error: String(err.message || err) };
  }
}

const PERMISSION_MODULE = {
  key: "dispatch",
  label: "调拨",
  route: "/dispatch",
  description: "调拨 Agent:清洗需求、计算调拨方案、生成 E3 导入模板",
};

module.exports = { tryRegister, isEnabled, PERMISSION_MODULE };
