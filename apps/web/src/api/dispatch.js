import http from "./http";

export async function createTask(formData) {
  const resp = await http.post("/api/dispatch/tasks", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return resp.data;
}

export async function listTasks() {
  const resp = await http.get("/api/dispatch/tasks");
  return resp.data;
}

export async function getTask(id) {
  const resp = await http.get(`/api/dispatch/tasks/${id}`);
  return resp.data;
}

export function subscribeEvents(taskId, onEvent) {
  const es = new EventSource(`/api/dispatch/tasks/${taskId}/events`);
  es.addEventListener("dispatch", (e) => {
    try {
      const data = JSON.parse(e.data);
      onEvent(data);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("SSE parse err", err);
    }
  });
  return () => es.close();
}

export function artifactUrl(taskId, name) {
  return `/api/dispatch/tasks/${taskId}/files/${encodeURIComponent(name)}`;
}

/**
 * GET /api/dispatch/public/preview?token=
 * 公开页（DispatchConfirmPage）无 cookie 鉴权，靠 token 一次性放行。
 *
 * @param {{ token: string }} params
 */
export async function getPublicPreview({ token }) {
  const resp = await http.get("/api/dispatch/public/preview", {
    params: { token, _t: Date.now() },
  });
  return resp.data;
}

/**
 * POST /api/dispatch/public/confirm?token=
 * @param {{ token: string, responses: object }} payload
 */
export async function postPublicConfirm({ token, responses }) {
  const resp = await http.post(
    "/api/dispatch/public/confirm",
    { responses },
    { params: { token } }
  );
  return resp.data;
}
