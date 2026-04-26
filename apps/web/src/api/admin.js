import http from "./http";

/**
 * GET /api/admin/accounts — 全部账号
 */
export async function listAccounts() {
  const resp = await http.get("/api/admin/accounts", { params: { _t: Date.now() } });
  return resp.data;
}

/**
 * POST /api/admin/accounts — 创建账号
 * @param {{ name: string, password: string, permissions?: string[] }} payload
 */
export async function createAccount(payload) {
  const resp = await http.post("/api/admin/accounts", payload);
  return resp.data;
}

/**
 * PATCH /api/admin/accounts/:id/permissions
 * @param {string} id
 * @param {{ permissions: string[] }} payload
 */
export async function patchAccountPermissions(id, payload) {
  const resp = await http.patch(`/api/admin/accounts/${encodeURIComponent(id)}/permissions`, payload);
  return resp.data;
}

/**
 * PATCH /api/admin/accounts/:id/password
 * @param {string} id
 * @param {{ password: string }} payload
 */
export async function patchAccountPassword(id, payload) {
  const resp = await http.patch(`/api/admin/accounts/${encodeURIComponent(id)}/password`, payload);
  return resp.data;
}

/**
 * GET /api/admin/usage — audit_log 聚合
 *
 * 时间窗口取后端白名单：`1 hour` / `6 hours` / `24 hours` / `7 days` / `30 days`
 *
 * @param {{ interval: string }} params
 */
export async function getUsage({ interval }) {
  const resp = await http.get("/api/admin/usage", {
    params: { interval, _t: Date.now() },
  });
  return resp.data;
}

/**
 * POST /api/admin/rebuild-weekly — 触发周报重建（异步 job）
 */
export async function postRebuildWeekly() {
  const resp = await http.post("/api/admin/rebuild-weekly", {});
  return resp.data;
}

/**
 * POST /api/admin/refresh-arrival — 触发新品看板刷新（异步 job）
 */
export async function postRefreshArrival() {
  const resp = await http.post("/api/admin/refresh-arrival", {});
  return resp.data;
}

/**
 * GET /api/admin/jobs/:id — 查询异步 job 状态（轮询用）
 * @param {string} id
 */
export async function getJob(id) {
  const resp = await http.get(`/api/admin/jobs/${encodeURIComponent(id)}`, {
    params: { _t: Date.now() },
  });
  return resp.data;
}
