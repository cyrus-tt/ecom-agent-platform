import http from "./http";

/**
 * GET /api/auth/me — 当前登录账号信息
 * @returns {Promise<{ ok: boolean, account?: object }>}
 */
export async function getMe() {
  const resp = await http.get("/api/auth/me", { params: { _t: Date.now() } });
  return resp.data;
}

/**
 * GET /api/settings/ai — 当前网关进程的 DeepSeek 配置（不返回 raw key）
 * @returns {Promise<{ settings: { configured: boolean, source: string, base_url?: string, model?: string } }>}
 */
export async function getAiSettings() {
  const resp = await http.get("/api/settings/ai", { params: { _t: Date.now() } });
  return resp.data;
}

/**
 * POST /api/settings/ai/deepseek-key — 把 DeepSeek key 写入当前网关进程内存
 * @param {{ apiKey: string }} payload
 */
export async function postDeepseekKey({ apiKey }) {
  const resp = await http.post("/api/settings/ai/deepseek-key", { api_key: apiKey });
  return resp.data;
}

/**
 * DELETE /api/settings/ai/deepseek-key — 清除当前会话的 DeepSeek key
 */
export async function deleteDeepseekKey() {
  const resp = await http.delete("/api/settings/ai/deepseek-key");
  return resp.data;
}
