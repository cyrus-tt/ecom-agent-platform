import { useEffect, useState } from "react";
import http from "../api/http";
import RichReport from "./RichReport";

export default function ReportDrawer({ reportId, onClose }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const open = !!reportId;

  useEffect(() => {
    if (!reportId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError("");
    setReport(null);

    http
      .get(`/api/agent/reports/${encodeURIComponent(reportId)}`, {
        params: { _t: Date.now() },
      })
      .then((resp) => {
        if (cancelled) return;
        const payload = resp?.data?.report || resp?.data || null;
        setReport(payload);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.data?.message || err?.message || "加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reportId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const title = report?.skill_name || "分析报告";
  const createdAt = report?.created_at ? formatDateTime(report.created_at) : "";
  const period = report?.period_start && report?.period_end ? `${report.period_start} ~ ${report.period_end}` : "";

  return (
    <>
      <div className={`chat-drawer-backdrop${open ? " is-open" : ""}`} onClick={onClose} />
      <aside className={`chat-drawer${open ? " is-open" : ""}`} aria-hidden={!open}>
        <header className="chat-drawer-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 className="chat-drawer-title">{title}</h3>
            {createdAt || period ? (
              <div className="chat-drawer-meta">
                {period ? <span>{period}</span> : null}
                {period && createdAt ? <span> · </span> : null}
                {createdAt ? <span>{createdAt}</span> : null}
              </div>
            ) : null}
          </div>
          <button type="button" className="chat-drawer-close" onClick={onClose} aria-label="关闭">
            x
          </button>
        </header>

        <div className="chat-drawer-body">
          {loading ? <div className="chat-drawer-loading">加载报告中...</div> : null}
          {error && !loading ? <div className="chat-drawer-empty">加载失败：{error}</div> : null}
          {!loading && !error && report ? <RichReport reportMd={report.report_md || ""} /> : null}
        </div>
      </aside>
    </>
  );
}

function formatDateTime(text) {
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return String(text);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
