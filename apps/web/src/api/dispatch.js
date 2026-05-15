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
