"use strict";

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";

let runtimeDeepseekApiKey = "";

function getEnvDeepseekApiKey() {
  return String(process.env.DEEPSEEK_API_KEY || "").trim();
}

function getRuntimeDeepseekApiKey() {
  return String(runtimeDeepseekApiKey || "").trim();
}

function getDeepseekApiKey() {
  return getRuntimeDeepseekApiKey() || getEnvDeepseekApiKey();
}

function setDeepseekApiKey(value) {
  const apiKey = String(value || "").trim();
  if (!apiKey) {
    throw new Error("api_key is required");
  }
  runtimeDeepseekApiKey = apiKey;
  return getDeepseekStatus();
}

function clearDeepseekApiKey() {
  runtimeDeepseekApiKey = "";
  return getDeepseekStatus();
}

function getDeepseekStatus() {
  const runtimeKey = getRuntimeDeepseekApiKey();
  const envKey = getEnvDeepseekApiKey();
  const activeKey = runtimeKey || envKey;
  return {
    provider: "deepseek",
    configured: Boolean(activeKey),
    source: runtimeKey ? "runtime" : envKey ? "environment" : "none",
    write_only: true,
    persists_until_restart: Boolean(runtimeKey),
    base_url: String(process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL),
    model: String(process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL),
  };
}

module.exports = {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  getDeepseekApiKey,
  getDeepseekStatus,
  setDeepseekApiKey,
  clearDeepseekApiKey,
};
