import http from "./http";

/**
 * GET /api/agent/skills — 列出可用分析技能
 */
export async function getSkills() {
  const resp = await http.get("/api/agent/skills", { params: { _t: Date.now() } });
  return resp.data;
}

/**
 * GET /api/agent/reports?page=&pageSize=
 * @param {{ page?: number, pageSize?: number }} params
 */
export async function listReports({ page, pageSize }) {
  const resp = await http.get("/api/agent/reports", {
    params: { page, pageSize, _t: Date.now() },
  });
  return resp.data;
}

/**
 * GET /api/agent/reports/:id
 * @param {string} id
 */
export async function getReport(id) {
  const resp = await http.get(`/api/agent/reports/${encodeURIComponent(id)}`, {
    params: { _t: Date.now() },
  });
  return resp.data;
}

/**
 * POST /api/agent/run — 触发一次分析
 * @param {{ periodType: string, startDate: string, endDate: string, skillId: string, promptText?: string }} payload
 */
export async function runAnalysis({ periodType, startDate, endDate, skillId, promptText }) {
  const resp = await http.post("/api/agent/run", {
    period_type: periodType,
    start_date: startDate,
    end_date: endDate,
    skill_id: skillId,
    prompt_text: promptText,
  });
  return resp.data;
}
