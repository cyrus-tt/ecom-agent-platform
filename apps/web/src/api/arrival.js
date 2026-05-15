import http from "./http";

/**
 * GET /api/arrival/status
 */
export async function getArrivalStatus() {
  const resp = await http.get("/api/arrival/status", { params: { _t: Date.now() } });
  return resp.data;
}

/**
 * GET /api/arrival/note-users
 */
export async function getArrivalNoteUsers() {
  const resp = await http.get("/api/arrival/note-users", { params: { _t: Date.now() } });
  return resp.data;
}

/**
 * GET /api/arrival/data
 */
export async function getArrivalData() {
  const resp = await http.get("/api/arrival/data", { params: { _t: Date.now() } });
  return resp.data;
}

/**
 * GET /api/arrival/review?sku=...
 * @param {{ sku: string }} params
 */
export async function getArrivalReview({ sku }) {
  const resp = await http.get("/api/arrival/review", {
    params: { sku, _t: Date.now() },
  });
  return resp.data;
}

/**
 * POST /api/arrival/refresh — 兜底分支，正式调用走 admin.refreshArrival
 */
export async function postArrivalRefresh() {
  const resp = await http.post("/api/arrival/refresh", {});
  return resp.data;
}
