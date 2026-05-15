(function () {
  "use strict";

  const el = {
    currentUser: document.getElementById("currentUser"),
    refreshHealthBtn: document.getElementById("refreshHealthBtn"),
    healthBox: document.getElementById("healthBox"),
    refreshArrivalBtn: document.getElementById("refreshArrivalBtn"),
    rebuildWeeklyBtn: document.getElementById("rebuildWeeklyBtn"),
    jobStatus: document.getElementById("jobStatus"),
    jobLog: document.getElementById("jobLog"),
  };

  let activeJobId = "";
  let pollingTimer = 0;

  init();

  function init() {
    bindEvents();
    loadCurrentUser();
    refreshHealth();
  }

  function bindEvents() {
    if (el.refreshHealthBtn) {
      el.refreshHealthBtn.addEventListener("click", refreshHealth);
    }
    if (el.refreshArrivalBtn) {
      el.refreshArrivalBtn.addEventListener("click", () => triggerJob("/api/admin/refresh-arrival"));
    }
    if (el.rebuildWeeklyBtn) {
      el.rebuildWeeklyBtn.addEventListener("click", () => triggerJob("/api/admin/rebuild-weekly"));
    }
  }

  async function api(url, options) {
    const resp = await fetch(url, {
      cache: "no-store",
      ...(options || {}),
      headers: {
        Accept: "application/json",
        ...((options && options.headers) || {}),
      },
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) {
      throw new Error(data.message || `Request failed: ${resp.status}`);
    }
    return data;
  }

  function setStatus(node, text, type) {
    if (!node) {
      return;
    }
    node.classList.remove("ok", "bad");
    if (type === "ok") {
      node.classList.add("ok");
    } else if (type === "bad") {
      node.classList.add("bad");
    }
    node.textContent = text || "";
  }

  async function loadCurrentUser() {
    try {
      const data = await api("/api/auth/me");
      if (el.currentUser) {
        el.currentUser.textContent = data.username || "-";
      }
    } catch (_err) {
      if (el.currentUser) {
        el.currentUser.textContent = "-";
      }
    }
  }

  async function refreshHealth() {
    setStatus(el.healthBox, "正在检查...", "");
    try {
      const data = await api("/api/health");
      const lines = [
        `网关: ${data.ok ? "正常" : "异常"}`,
        `报表数据库: ${data.report_db && data.report_db.ok ? "正常" : "异常"} (${(data.report_db && data.report_db.message) || "-"})`,
        `新品服务: ${data.upstream && data.upstream.arrival && data.upstream.arrival.ok ? "正常" : "异常"}`,
        `备注服务: ${data.upstream && data.upstream.notes && data.upstream.notes.ok ? "正常" : "异常"}`,
        `时间: ${data.server_time || "-"}`,
      ];
      setStatus(el.healthBox, lines.join("\n"), data.ok ? "ok" : "bad");
    } catch (err) {
      setStatus(el.healthBox, err && err.message ? err.message : "健康检查失败", "bad");
    }
  }

  async function triggerJob(url) {
    try {
      disableJobButtons(true);
      setStatus(el.jobStatus, "任务启动中...", "");
      const data = await api(url, { method: "POST" });
      if (!data.job || !data.job.id) {
        const message = data.message || "任务执行完成";
        setStatus(el.jobStatus, message, "ok");
        renderJobLog([]);
        disableJobButtons(false);
        refreshHealth();
        return;
      }

      activeJobId = data.job.id;
      const desc = data.reused
        ? `复用执行中的任务：${data.job.type} (${data.job.id})`
        : `任务已启动：${data.job.type} (${data.job.id})`;
      setStatus(el.jobStatus, desc, "ok");
      renderJobLog(data.job.logs || []);
      startPollingJob();
    } catch (err) {
      setStatus(el.jobStatus, err && err.message ? err.message : "任务启动失败", "bad");
      disableJobButtons(false);
    }
  }

  function renderJobLog(lines) {
    if (!el.jobLog) {
      return;
    }
    el.jobLog.textContent = Array.isArray(lines) && lines.length ? lines.join("\n") : "";
    el.jobLog.scrollTop = el.jobLog.scrollHeight;
  }

  function disableJobButtons(disabled) {
    if (el.refreshArrivalBtn) {
      el.refreshArrivalBtn.disabled = !!disabled;
    }
    if (el.rebuildWeeklyBtn) {
      el.rebuildWeeklyBtn.disabled = !!disabled;
    }
  }

  function startPollingJob() {
    if (pollingTimer) {
      window.clearInterval(pollingTimer);
      pollingTimer = 0;
    }
    pollingTimer = window.setInterval(pollJob, 1500);
    pollJob();
  }

  async function pollJob() {
    if (!activeJobId) {
      return;
    }
    try {
      const data = await api(`/api/admin/jobs/${encodeURIComponent(activeJobId)}`);
      const job = data.job || {};
      const statusText = [
        `任务: ${job.type || "-"}`,
        `状态: ${job.status || "-"}`,
        `开始: ${job.started_at || "-"}`,
        `结束: ${job.ended_at || "-"}`,
        `退出码: ${job.exit_code === null ? "-" : job.exit_code}`,
      ].join(" | ");

      const type = job.status === "succeeded" ? "ok" : (job.status === "failed" ? "bad" : "");
      setStatus(el.jobStatus, statusText, type);
      renderJobLog(job.logs || []);

      if (job.status !== "running") {
        if (pollingTimer) {
          window.clearInterval(pollingTimer);
          pollingTimer = 0;
        }
        disableJobButtons(false);
        refreshHealth();
      }
    } catch (err) {
      setStatus(el.jobStatus, err && err.message ? err.message : "任务轮询失败", "bad");
      if (pollingTimer) {
        window.clearInterval(pollingTimer);
        pollingTimer = 0;
      }
      disableJobButtons(false);
    }
  }
})();
