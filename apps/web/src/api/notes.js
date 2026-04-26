import http from "./http";

/**
 * notes 服务挂在独立 base url（python 子进程，端口 5190），
 * gateway 把 base 透传给前端，前端运行时拼。
 *
 * @param {string} baseUrl
 * @param {string} suffix
 */
function buildUrl(baseUrl, suffix) {
  const trimmed = String(baseUrl || "").replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("notes baseUrl 未配置");
  }
  return `${trimmed}${suffix}`;
}

/**
 * GET {baseUrl}/notes?user_id=
 * @param {{ baseUrl: string, userId: string }} params
 */
export async function listNotes({ baseUrl, userId }) {
  const resp = await http.get(buildUrl(baseUrl, "/notes"), {
    params: { user_id: userId, _t: Date.now() },
  });
  return resp.data;
}

/**
 * POST {baseUrl}/notes/upsert
 * @param {{ baseUrl: string, sku: string, userId: string, tag?: string, remark?: string, isFollowing?: boolean, updatedBy?: string }} payload
 */
export async function upsertNote({ baseUrl, sku, userId, tag, remark, isFollowing, updatedBy }) {
  const resp = await http.post(buildUrl(baseUrl, "/notes/upsert"), {
    sku,
    user_id: userId,
    tag,
    remark,
    is_following: isFollowing,
    updated_by: updatedBy ?? userId,
  });
  return resp.data;
}

/**
 * POST {baseUrl}/notes/bulk_upsert
 * @param {{ baseUrl: string, skus: string[], userId: string, tag?: string, remark?: string, isFollowing?: boolean, updatedBy?: string }} payload
 */
export async function bulkUpsertNotes({ baseUrl, skus, userId, tag, remark, isFollowing, updatedBy }) {
  const resp = await http.post(buildUrl(baseUrl, "/notes/bulk_upsert"), {
    skus,
    user_id: userId,
    tag,
    remark,
    is_following: isFollowing,
    updated_by: updatedBy ?? userId,
  });
  return resp.data;
}
