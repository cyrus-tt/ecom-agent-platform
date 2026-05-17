import {
  AlertOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
  PlayCircleOutlined,
  SearchOutlined,
  MessageOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Collapse,
  Empty,
  Spin,
  Table,
  Tag,
  Timeline,
  Tooltip,
  message,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import http, { errorMessage } from "../api/http";

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

function relativeTime(dateStr) {
  if (!dateStr) return "-";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return "-";
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return "昨天";
  if (diffDay < 7) return `${diffDay} 天前`;
  return new Date(dateStr).toLocaleDateString("zh-CN");
}

function severityOrder(severity) {
  if (severity === "critical") return 0;
  if (severity === "warning") return 1;
  if (severity === "info") return 2;
  return 3;
}

function severityColor(severity) {
  if (severity === "critical") return "#cf1322";
  if (severity === "warning") return "#d46b08";
  return "#1677ff";
}

function severityLabel(severity) {
  if (severity === "critical") return "严重";
  if (severity === "warning") return "警告";
  return "信息";
}

function severityEmoji(severity) {
  if (severity === "critical") return "🔴";
  if (severity === "warning") return "🟡";
  return "🔵";
}

function severityCssClass(severity) {
  if (severity === "critical") return "agent-dash-severity-critical";
  if (severity === "warning") return "agent-dash-severity-warning";
  return "agent-dash-severity-info";
}

function formatChangePct(value) {
  if (value == null || value === "" || Number.isNaN(Number(value))) return null;
  const num = Number(value);
  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toFixed(1)}%`;
}

/* ------------------------------------------------------------------ */
/*  Section A: Today's Briefing                                        */
/* ------------------------------------------------------------------ */

function BriefingCard({ inspection, loading, onTrigger, triggerLoading }) {
  const { isAdmin } = useAuth();

  if (loading) {
    return (
      <div className="agent-dash-briefing">
        <Spin />
        <span style={{ marginLeft: 12, color: "#ffffffcc" }}>正在加载巡检数据...</span>
      </div>
    );
  }

  if (!inspection) {
    return (
      <div className="agent-dash-briefing">
        <div className="agent-dash-briefing-title">今日尚未巡检</div>
        <div className="agent-dash-briefing-sub">
          Agent 尚未执行今日巡检，数据就绪后将自动运行。
        </div>
        {isAdmin && (
          <Button
            type="primary"
            ghost
            icon={<PlayCircleOutlined />}
            loading={triggerLoading}
            onClick={onTrigger}
            style={{ marginTop: 12, borderColor: "#ffffffaa", color: "#fff" }}
          >
            手动触发
          </Button>
        )}
      </div>
    );
  }

  const anomalies = Array.isArray(inspection.anomalies) ? inspection.anomalies : [];
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const a of anomalies) {
    const s = a.severity || "info";
    if (counts[s] !== undefined) counts[s]++;
  }
  const totalAnomalies = anomalies.length;

  return (
    <div className="agent-dash-briefing">
      <div className="agent-dash-briefing-title">
        <CheckCircleOutlined style={{ marginRight: 8 }} />
        今日巡检完成 · {totalAnomalies} 个异常
      </div>
      <div className="agent-dash-briefing-badges">
        {counts.critical > 0 && (
          <span className="agent-dash-briefing-badge agent-dash-severity-critical">
            {severityEmoji("critical")} 严重 {counts.critical}
          </span>
        )}
        {counts.warning > 0 && (
          <span className="agent-dash-briefing-badge agent-dash-severity-warning">
            {severityEmoji("warning")} 警告 {counts.warning}
          </span>
        )}
        {counts.info > 0 && (
          <span className="agent-dash-briefing-badge agent-dash-severity-info">
            {severityEmoji("info")} 信息 {counts.info}
          </span>
        )}
        {totalAnomalies === 0 && (
          <span className="agent-dash-briefing-badge" style={{ background: "rgba(255,255,255,0.15)" }}>
            一切正常
          </span>
        )}
      </div>
      <div className="agent-dash-briefing-sub">
        <ClockCircleOutlined style={{ marginRight: 6 }} />
        巡检时间：{inspection.created_at ? new Date(inspection.created_at).toLocaleString("zh-CN") : "-"}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section B: Anomaly List                                            */
/* ------------------------------------------------------------------ */

function AnomalyList({ anomalies }) {
  if (!anomalies || anomalies.length === 0) {
    return (
      <div className="agent-dash-empty">
        <Empty description="暂无异常，一切正常 ✅" />
      </div>
    );
  }

  const sorted = [...anomalies].sort(
    (a, b) => severityOrder(a.severity) - severityOrder(b.severity)
  );

  const items = sorted.map((item, idx) => ({
    key: String(idx),
    label: (
      <div className="agent-dash-anomaly-header">
        <span
          className="agent-dash-anomaly-dot"
          style={{ background: severityColor(item.severity) }}
        />
        <Tag color={severityColor(item.severity)} style={{ marginRight: 8 }}>
          {severityLabel(item.severity)}
        </Tag>
        <span className="agent-dash-anomaly-title">{item.title || "未命名异常"}</span>
        {item.change_pct != null && (
          <span
            className={`agent-dash-metric-change ${Number(item.change_pct) > 0 ? "positive" : "negative"}`}
          >
            {formatChangePct(item.change_pct)}
          </span>
        )}
      </div>
    ),
    children: (
      <div className="agent-dash-anomaly-body">
        <p className="agent-dash-anomaly-desc">{item.description || "无详细描述"}</p>
        {(item.current_value != null || item.previous_value != null) && (
          <div className="agent-dash-anomaly-metrics">
            <span className="agent-dash-anomaly-metric-label">指标变化：</span>
            <span>{item.previous_value ?? "-"}</span>
            <span style={{ margin: "0 6px", color: "#999" }}>→</span>
            <span style={{ fontWeight: 600 }}>{item.current_value ?? "-"}</span>
            {item.change_pct != null && (
              <span
                className={`agent-dash-metric-change ${Number(item.change_pct) > 0 ? "positive" : "negative"}`}
                style={{ marginLeft: 8 }}
              >
                ({formatChangePct(item.change_pct)})
              </span>
            )}
          </div>
        )}
        {item.suggested_action && (
          <div className="agent-dash-anomaly-action">
            <strong>建议操作：</strong> {item.suggested_action}
          </div>
        )}
      </div>
    ),
  }));

  return (
    <Collapse
      items={items}
      bordered={false}
      expandIconPosition="end"
      className="agent-dash-anomaly-collapse"
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Section C: Activity Timeline                                       */
/* ------------------------------------------------------------------ */

function ActivityTimeline({ activities, loading }) {
  if (loading) {
    return (
      <div className="agent-dash-empty">
        <Spin size="small" />
      </div>
    );
  }

  if (!activities || activities.length === 0) {
    return (
      <div className="agent-dash-empty">
        <Empty description="暂无活动记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  const timelineItems = activities.map((act, idx) => {
    const isInspection = act.type === "inspection";
    const icon = isInspection ? (
      <SearchOutlined style={{ fontSize: 14 }} />
    ) : (
      <MessageOutlined style={{ fontSize: 14 }} />
    );
    const color = isInspection ? "#165dff" : "#722ed1";

    return {
      key: String(idx),
      dot: icon,
      color,
      children: (
        <div className="agent-dash-timeline-item">
          <div className="agent-dash-timeline-time">{relativeTime(act.created_at || act.timestamp)}</div>
          <div className="agent-dash-timeline-summary">
            {isInspection ? "🔍 " : "💬 "}
            {act.summary || act.title || "活动"}
          </div>
          {isInspection && act.anomaly_count != null && (
            <Tag
              color={act.anomaly_count > 0 ? "orange" : "green"}
              style={{ marginTop: 4 }}
            >
              {act.anomaly_count} 个异常
            </Tag>
          )}
        </div>
      ),
    };
  });

  return (
    <div className="agent-dash-timeline">
      <Timeline items={timelineItems} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section D: Historical Inspections Table                            */
/* ------------------------------------------------------------------ */

function HistoryTable({ inspections, loading }) {
  const columns = [
    {
      title: "日期",
      dataIndex: "created_at",
      key: "date",
      width: 160,
      render: (val) => (val ? new Date(val).toLocaleDateString("zh-CN") : "-"),
    },
    {
      title: "异常数",
      dataIndex: "anomaly_count",
      key: "anomaly_count",
      width: 100,
      render: (val) => {
        const count = val ?? 0;
        let color = "green";
        if (count >= 3) color = "red";
        else if (count >= 1) color = "orange";
        return <Tag color={color}>{count}</Tag>;
      },
    },
    {
      title: "摘要",
      dataIndex: "summary",
      key: "summary",
      ellipsis: true,
      render: (val) => val || "-",
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (val) => {
        if (val === "completed" || val === "done") {
          return <Tag color="success">完成</Tag>;
        }
        if (val === "running") {
          return <Tag color="processing">运行中</Tag>;
        }
        if (val === "failed") {
          return <Tag color="error">失败</Tag>;
        }
        return <Tag>{val || "-"}</Tag>;
      },
    },
  ];

  const expandable = {
    expandedRowRender: (record) => {
      const anomalies = Array.isArray(record.anomalies) ? record.anomalies : [];
      if (anomalies.length === 0) {
        return <Empty description="该次巡检无异常" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
      }
      return (
        <div className="agent-dash-history-anomalies">
          {anomalies
            .sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity))
            .map((a, i) => (
              <div key={i} className={`agent-dash-anomaly-card ${severityCssClass(a.severity)}`}>
                <div className="agent-dash-anomaly-header">
                  <Tag color={severityColor(a.severity)}>{severityLabel(a.severity)}</Tag>
                  <strong>{a.title || "未命名"}</strong>
                </div>
                <div style={{ color: "#666", marginTop: 4 }}>{a.description || "-"}</div>
                {a.suggested_action && (
                  <div className="agent-dash-anomaly-action" style={{ marginTop: 6 }}>
                    {a.suggested_action}
                  </div>
                )}
              </div>
            ))}
        </div>
      );
    },
    rowExpandable: () => true,
  };

  return (
    <Table
      columns={columns}
      dataSource={(inspections || []).map((item, idx) => ({ ...item, key: item.id || idx }))}
      loading={loading}
      expandable={expandable}
      pagination={{ pageSize: 10, hideOnSinglePage: true }}
      size="middle"
      locale={{ emptyText: <Empty description="暂无历史巡检记录" /> }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page Component                                                */
/* ------------------------------------------------------------------ */

export default function AgentDashboardPage() {
  const { isAdmin } = useAuth();

  // Latest inspection (Section A + B)
  const [latestInspection, setLatestInspection] = useState(null);
  const [latestLoading, setLatestLoading] = useState(true);
  const [triggerLoading, setTriggerLoading] = useState(false);

  // Activity timeline (Section C)
  const [activities, setActivities] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);

  // Historical inspections (Section D)
  const [historyInspections, setHistoryInspections] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const fetchLatest = useCallback(async () => {
    setLatestLoading(true);
    try {
      const resp = await http.get("/api/agent/inspections/latest", {
        params: { _t: Date.now() },
      });
      setLatestInspection(resp.data?.inspection || null);
    } catch (err) {
      // 404 means no inspection today, that's fine
      if (err?.response?.status !== 404) {
        message.error(errorMessage(err, "获取最新巡检失败"));
      }
      setLatestInspection(null);
    } finally {
      setLatestLoading(false);
    }
  }, []);

  const fetchActivities = useCallback(async () => {
    setActivityLoading(true);
    try {
      const resp = await http.get("/api/agent/activity", {
        params: { days: 7, _t: Date.now() },
      });
      setActivities(Array.isArray(resp.data?.activities) ? resp.data.activities : []);
    } catch (err) {
      if (err?.response?.status !== 404) {
        message.error(errorMessage(err, "获取活动记录失败"));
      }
      setActivities([]);
    } finally {
      setActivityLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const resp = await http.get("/api/agent/inspections", {
        params: { limit: 10, _t: Date.now() },
      });
      setHistoryInspections(
        Array.isArray(resp.data?.inspections) ? resp.data.inspections : []
      );
    } catch (err) {
      if (err?.response?.status !== 404) {
        message.error(errorMessage(err, "获取历史巡检失败"));
      }
      setHistoryInspections([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLatest();
    void fetchActivities();
    void fetchHistory();
  }, [fetchLatest, fetchActivities, fetchHistory]);

  async function handleTriggerInspection() {
    setTriggerLoading(true);
    try {
      await http.post("/api/admin/inspection/run", null, {
        params: { _t: Date.now() },
      });
      message.success("巡检已触发，请稍后刷新查看结果");
      // Re-fetch after a short delay to give the agent time to start
      setTimeout(() => {
        void fetchLatest();
        void fetchActivities();
        void fetchHistory();
      }, 3000);
    } catch (err) {
      message.error(errorMessage(err, "触发巡检失败"));
    } finally {
      setTriggerLoading(false);
    }
  }

  const anomalies = latestInspection?.anomalies || [];

  return (
    <div className="agent-dash-page">
      {/* Section A: Today's Briefing */}
      <BriefingCard
        inspection={latestInspection}
        loading={latestLoading}
        onTrigger={handleTriggerInspection}
        triggerLoading={triggerLoading}
      />

      {/* Section B + C: Anomaly List + Activity Timeline */}
      <div className="agent-dash-grid">
        <Card
          title={
            <span>
              <ExclamationCircleOutlined style={{ marginRight: 8, color: "#d46b08" }} />
              异常列表
              {anomalies.length > 0 && (
                <Tag color="orange" style={{ marginLeft: 8 }}>
                  {anomalies.length}
                </Tag>
              )}
            </span>
          }
          className="agent-dash-card"
          loading={latestLoading}
        >
          <AnomalyList anomalies={anomalies} />
        </Card>

        <Card
          title={
            <span>
              <ClockCircleOutlined style={{ marginRight: 8, color: "#165dff" }} />
              Agent 活动记录 (近 7 天)
            </span>
          }
          className="agent-dash-card"
        >
          <ActivityTimeline activities={activities} loading={activityLoading} />
        </Card>
      </div>

      {/* Section D: Historical Inspections */}
      <Card
        title={
          <span>
            <AlertOutlined style={{ marginRight: 8, color: "#531dab" }} />
            历史巡检记录
          </span>
        }
        className="agent-dash-card"
        style={{ marginTop: 16 }}
      >
        <HistoryTable inspections={historyInspections} loading={historyLoading} />
      </Card>
    </div>
  );
}
