import {
  AlertOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
  PlayCircleOutlined,
  SearchOutlined,
  MessageOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  Badge,
  Button,
  Card,
  Collapse,
  Empty,
  Input,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
  Timeline,
  Tooltip,
  message,
} from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
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

function BriefingCard({ inspection, loading, onTrigger, triggerLoading, digestMessage, aiInsight }) {
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
      <div className="agent-dash-briefing-sub" style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span>
          <ClockCircleOutlined style={{ marginRight: 6 }} />
          巡检时间：{inspection.created_at ? new Date(inspection.created_at).toLocaleString("zh-CN") : "-"}
        </span>
        {inspection.id && (
          <Button
            size="small"
            ghost
            icon={<DownloadOutlined />}
            style={{ borderColor: "rgba(255,255,255,0.5)", color: "#fff" }}
            onClick={() => {
              const link = document.createElement("a");
              link.href = `/api/agent/inspections/${inspection.id}/report`;
              link.download = "";
              link.click();
            }}
          >
            下载报告
          </Button>
        )}
      </div>
      {aiInsight && (
        <div className="agent-dash-briefing-insight">
          <div className="agent-dash-insight-title">AI Analysis</div>
          <div>{aiInsight.pattern_summary}</div>
          {aiInsight.key_insight && <div style={{ marginTop: 4 }}>{aiInsight.key_insight}</div>}
          {aiInsight.priority_actions?.length > 0 && (
            <div style={{ marginTop: 4 }}>
              {aiInsight.priority_actions.map((a, i) => (
                <div key={i}>• {a}</div>
              ))}
            </div>
          )}
        </div>
      )}
      {digestMessage && !aiInsight && (
        <div className="agent-dash-briefing-digest">
          {digestMessage.split("\n").map((line, i) => (
            <div key={i}>{line || <br />}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Visualization: Sparkline + Reasoning Chain                         */
/* ------------------------------------------------------------------ */

function AnomalySparkline({ data, anchorDate }) {
  if (!data || data.length === 0) return null;

  const option = {
    grid: { left: 0, right: 0, top: 8, bottom: 0, containLabel: false },
    xAxis: { type: "category", show: false, data: data.map((d) => d.date) },
    yAxis: { type: "value", show: false, min: "dataMin" },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const p = params[0];
        return `${p.name}<br/>GMV: &yen;${Number(p.value).toLocaleString("zh-CN")}`;
      },
    },
    series: [
      {
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, color: "#1677ff" },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(22,119,255,0.15)" },
              { offset: 1, color: "rgba(22,119,255,0.02)" },
            ],
          },
        },
        data: data.map((d) => d.gmv),
        markPoint: anchorDate
          ? {
              symbol: "circle",
              symbolSize: 8,
              data: [
                {
                  xAxis: anchorDate,
                  yAxis: data.find((d) => d.date === anchorDate)?.gmv || 0,
                  itemStyle: { color: "#cf1322" },
                },
              ],
            }
          : undefined,
      },
    ],
  };

  return (
    <div className="agent-dash-sparkline">
      <div className="agent-dash-sparkline-label">7 日 GMV 趋势（红点为异常日）</div>
      <ReactECharts option={option} style={{ height: 120 }} notMerge lazyUpdate />
    </div>
  );
}

const THRESHOLDS = {
  sales_drop_dod: { label: "日环比检测", warn: 10, crit: 25, unit: "%" },
  sales_drop_wow: { label: "周环比检测", warn: 15, crit: 30, unit: "%" },
  zero_sales_sku: { label: "零销量SKU检测", warn: 20, crit: null, unit: "个" },
  new_product_underperform: { label: "新品表现检测", warn: 7, crit: null, unit: "天" },
};

function ReasoningChain({ anomaly }) {
  const th = THRESHOLDS[anomaly?.type];
  if (!th) return null;

  const steps = [th.label];

  if (anomaly.type === "sales_drop_dod" || anomaly.type === "sales_drop_wow") {
    steps.push(`阈值: >${th.warn}% 报 warning${th.crit ? `, >${th.crit}% 报 critical` : ""}`);
    const pct = anomaly.change_pct != null ? `${Number(anomaly.change_pct).toFixed(1)}%` : "-";
    steps.push(`实际: ${pct}`);
  } else if (anomaly.type === "zero_sales_sku") {
    steps.push(`阈值: 零销SKU > ${th.warn}${th.unit}`);
    steps.push(`实际: ${anomaly.metric_current ?? "-"}${th.unit}`);
  } else if (anomaly.type === "new_product_underperform") {
    steps.push(`阈值: 上架 >${th.warn}天仍零销`);
    steps.push(`实际: ${anomaly.metric_current ?? "-"} 个SKU`);
  }

  const sLabel = anomaly.severity === "critical" ? "严重" : anomaly.severity === "warning" ? "警告" : "信息";
  steps.push(`判定: ${sLabel}`);

  return (
    <div className="agent-dash-reasoning">
      <div className="agent-dash-reasoning-steps">
        {steps.map((step, i) => (
          <span key={i} className="agent-dash-reasoning-step">
            {step}
            {i < steps.length - 1 && <span className="agent-dash-reasoning-arrow"> → </span>}
          </span>
        ))}
      </div>
    </div>
  );
}

function extractChannelCode(description) {
  const match = description?.match(/\((\w+)\)/);
  return match ? match[1] : null;
}

/* ------------------------------------------------------------------ */
/*  Section B: Anomaly List                                            */
/* ------------------------------------------------------------------ */

function AnomalyList({ anomalies, onAcknowledge }) {
  const [trendCache, setTrendCache] = useState({});
  const fetchedRef = useRef(new Set());

  const fetchTrend = useCallback(async (channelCode, anchorDate) => {
    const key = `${channelCode}_${anchorDate || ""}`;
    if (fetchedRef.current.has(key)) return;
    fetchedRef.current.add(key);
    try {
      const params = { channel: channelCode, _t: Date.now() };
      if (anchorDate) params.anchor_date = anchorDate;
      const resp = await http.get("/api/agent/channel-trend", { params });
      setTrendCache((prev) => ({ ...prev, [key]: resp.data?.data || [] }));
    } catch {
      setTrendCache((prev) => ({ ...prev, [key]: [] }));
    }
  }, []);

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

  function handleCollapseChange(keys) {
    for (const key of keys) {
      const idx = Number(key);
      const item = sorted[idx];
      if (!item) continue;
      if (item.type !== "sales_drop_dod" && item.type !== "sales_drop_wow") continue;
      const ch = extractChannelCode(item.description);
      if (ch) {
        const anchor = item.created_at ? item.created_at.slice(0, 10) : undefined;
        fetchTrend(ch, anchor);
      }
    }
  }

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
        <ReasoningChain anomaly={item} />
        {(() => {
          const ch = extractChannelCode(item.description);
          if (!ch || (item.type !== "sales_drop_dod" && item.type !== "sales_drop_wow")) return null;
          const anchor = item.created_at ? item.created_at.slice(0, 10) : "";
          const key = `${ch}_${anchor}`;
          const data = trendCache[key];
          if (!data) return null;
          return <AnomalySparkline data={data} anchorDate={anchor} />;
        })()}
        {item.suggested_action && (
          <div className="agent-dash-anomaly-action">
            <strong>建议操作：</strong> {item.suggested_action}
          </div>
        )}
        {item.id && item.status === "open" && onAcknowledge && (
          <div style={{ marginTop: 8 }}>
            <Button
              size="small"
              icon={<CheckCircleOutlined />}
              onClick={() => onAcknowledge(item.id)}
            >
              已知悉，标记为已处理
            </Button>
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
      onChange={handleCollapseChange}
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
/*  Section E: Approval Queue                                          */
/* ------------------------------------------------------------------ */

function riskLevelTag(level) {
  if (level === "high") return <Tag color="red">高风险</Tag>;
  if (level === "medium") return <Tag color="orange">中风险</Tag>;
  return <Tag color="blue">低风险</Tag>;
}

function proposalStatusTag(status) {
  const map = {
    pending: { color: "gold", text: "待审批" },
    approved: { color: "blue", text: "已批准" },
    executed: { color: "green", text: "已执行" },
    rejected: { color: "default", text: "已拒绝" },
    failed: { color: "red", text: "执行失败" },
  };
  const cfg = map[status] || { color: "default", text: status };
  return <Tag color={cfg.color}>{cfg.text}</Tag>;
}

function actionTypeLabel(type) {
  const map = {
    notify: "发送通知",
    acknowledge: "确认记录",
    investigate: "排查调查",
    adjust_inventory: "库存调整",
    create_promotion: "制定推广",
  };
  return map[type] || type;
}

function ApprovalQueue({ proposals, loading, onApprove, onReject, onBatchApprove, onRefresh }) {
  const { isAdmin } = useAuth();
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState({});

  const pending = (proposals || []).filter((p) => p.status === "pending");
  const decided = (proposals || []).filter((p) => p.status !== "pending");

  async function handleApprove(id) {
    setActionLoading((s) => ({ ...s, [id]: true }));
    try {
      await onApprove(id);
    } finally {
      setActionLoading((s) => ({ ...s, [id]: false }));
    }
  }

  function handleRejectClick(proposal) {
    setRejectModal(proposal);
    setRejectReason("");
  }

  async function handleRejectConfirm() {
    if (!rejectModal) return;
    setActionLoading((s) => ({ ...s, [rejectModal.id]: true }));
    try {
      await onReject(rejectModal.id, rejectReason);
    } finally {
      setActionLoading((s) => ({ ...s, [rejectModal.id]: false }));
      setRejectModal(null);
      setRejectReason("");
    }
  }

  if (loading) {
    return <Spin size="small" />;
  }

  if (!proposals || proposals.length === 0) {
    return <Empty description="暂无待处理建议" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <div className="agent-dash-proposals">
      {pending.length > 0 && (
        <div className="agent-dash-proposals-pending">
          {isAdmin && pending.length > 1 && (
            <div className="agent-dash-proposal-batch">
              <Button
                type="primary"
                icon={<CheckOutlined />}
                onClick={onBatchApprove}
              >
                全部批准 ({pending.length})
              </Button>
            </div>
          )}
          {pending.map((p) => (
            <div key={p.id} className="agent-dash-proposal-card pending">
              <div className="agent-dash-proposal-header">
                {riskLevelTag(p.risk_level)}
                <Tag>{actionTypeLabel(p.action_type)}</Tag>
                <span className="agent-dash-proposal-title">{p.title}</span>
              </div>
              {p.description && (
                <div className="agent-dash-proposal-desc">{p.description}</div>
              )}
              <div className="agent-dash-proposal-time">
                <ClockCircleOutlined style={{ marginRight: 4 }} />
                {relativeTime(p.created_at)}
              </div>
              {isAdmin && (
                <div className="agent-dash-proposal-actions">
                  <Space>
                    <Button
                      type="primary"
                      size="small"
                      icon={<CheckOutlined />}
                      loading={actionLoading[p.id]}
                      onClick={() => handleApprove(p.id)}
                    >
                      批准执行
                    </Button>
                    <Button
                      size="small"
                      danger
                      icon={<CloseOutlined />}
                      loading={actionLoading[p.id]}
                      onClick={() => handleRejectClick(p)}
                    >
                      拒绝
                    </Button>
                  </Space>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <Collapse
          items={[
            {
              key: "decided",
              label: `已处理建议 (${decided.length})`,
              children: (
                <div className="agent-dash-proposals-decided">
                  {decided.map((p) => (
                    <div key={p.id} className={`agent-dash-proposal-card ${p.status}`}>
                      <div className="agent-dash-proposal-header">
                        {proposalStatusTag(p.status)}
                        <Tag>{actionTypeLabel(p.action_type)}</Tag>
                        <span className="agent-dash-proposal-title">{p.title}</span>
                      </div>
                      {p.reject_reason && (
                        <div className="agent-dash-proposal-desc" style={{ color: "#cf1322" }}>
                          拒绝原因：{p.reject_reason}
                        </div>
                      )}
                      <div className="agent-dash-proposal-time">
                        {relativeTime(p.decided_at || p.created_at)}
                      </div>
                    </div>
                  ))}
                </div>
              ),
            },
          ]}
          bordered={false}
          ghost
        />
      )}

      <Modal
        title="拒绝建议"
        open={!!rejectModal}
        onOk={handleRejectConfirm}
        onCancel={() => setRejectModal(null)}
        okText="确认拒绝"
        cancelText="取消"
      >
        <p>确定拒绝：{rejectModal?.title}？</p>
        <Input.TextArea
          placeholder="拒绝原因（可选）"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          rows={3}
        />
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section F: Effect Tracking                                         */
/* ------------------------------------------------------------------ */

function outcomeColor(outcome) {
  if (outcome === "improved") return "#52c41a";
  if (outcome === "worsened") return "#cf1322";
  return "#999";
}

function outcomeLabel(outcome) {
  const map = { improved: "改善", unchanged: "持平", worsened: "恶化", pending: "待评估" };
  return map[outcome] || outcome;
}

function EffectTracker({ summary, recentEffects, loading }) {
  if (loading) return <Spin size="small" />;

  if (!summary || summary.total === 0) {
    return <Empty description="暂无效果追踪数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const successRate = summary.total - summary.pending > 0
    ? Math.round((summary.improved / (summary.total - summary.pending)) * 100)
    : 0;

  return (
    <div className="agent-dash-effects">
      <div className="agent-dash-effects-summary">
        <div className="agent-dash-effects-stat">
          <div className="agent-dash-effects-stat-value" style={{ color: "#52c41a" }}>
            {successRate}%
          </div>
          <div className="agent-dash-effects-stat-label">建议有效率</div>
        </div>
        <div className="agent-dash-effects-stat">
          <div className="agent-dash-effects-stat-value">{summary.improved}</div>
          <div className="agent-dash-effects-stat-label">改善</div>
        </div>
        <div className="agent-dash-effects-stat">
          <div className="agent-dash-effects-stat-value">{summary.unchanged}</div>
          <div className="agent-dash-effects-stat-label">持平</div>
        </div>
        <div className="agent-dash-effects-stat">
          <div className="agent-dash-effects-stat-value" style={{ color: "#cf1322" }}>
            {summary.worsened}
          </div>
          <div className="agent-dash-effects-stat-label">恶化</div>
        </div>
        <div className="agent-dash-effects-stat">
          <div className="agent-dash-effects-stat-value" style={{ color: "#999" }}>
            {summary.pending}
          </div>
          <div className="agent-dash-effects-stat-label">待评估</div>
        </div>
      </div>

      {recentEffects && recentEffects.length > 0 && (
        <div className="agent-dash-effects-list">
          {recentEffects.slice(0, 5).map((e) => (
            <div key={e.id} className="agent-dash-effect-item">
              <div className="agent-dash-effect-header">
                <Tag color={outcomeColor(e.outcome)}>{outcomeLabel(e.outcome)}</Tag>
                <span className="agent-dash-effect-title">{e.proposal_title}</span>
              </div>
              <div className="agent-dash-effect-metrics">
                <span>{e.baseline_value ?? "-"}</span>
                <span style={{ margin: "0 6px", color: "#999" }}>→</span>
                <span style={{ fontWeight: 600 }}>{e.followup_value ?? "-"}</span>
                {e.change_pct != null && (
                  <span style={{ marginLeft: 8, color: outcomeColor(e.outcome) }}>
                    {formatChangePct(e.change_pct)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
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
  const [digestMessage, setDigestMessage] = useState(null);
  const [aiInsight, setAiInsight] = useState(null);

  // Approval queue (Section E)
  const [proposals, setProposals] = useState([]);
  const [proposalsLoading, setProposalsLoading] = useState(true);

  // Effect tracking (Section F)
  const [effectsSummary, setEffectsSummary] = useState(null);
  const [recentEffects, setRecentEffects] = useState([]);
  const [effectsLoading, setEffectsLoading] = useState(true);

  // Activity timeline (Section C)
  const [activities, setActivities] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);

  // Historical inspections (Section D)
  const [historyInspections, setHistoryInspections] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const fetchLatest = useCallback(async () => {
    setLatestLoading(true);
    try {
      const [inspResp, digestResp, insightResp] = await Promise.all([
        http.get("/api/agent/inspections/latest", { params: { _t: Date.now() } }),
        http.get("/api/agent/digest", { params: { _t: Date.now() } }).catch(() => ({ data: {} })),
        http.get("/api/agent/inspections/latest/insight", { params: { _t: Date.now() } }).catch(() => ({ data: {} })),
      ]);
      setLatestInspection(inspResp.data?.inspection || null);
      setDigestMessage(digestResp.data?.message || null);
      setAiInsight(insightResp.data?.insight || null);
    } catch (err) {
      if (err?.response?.status !== 404) {
        message.error(errorMessage(err, "获取最新巡检失败"));
      }
      setLatestInspection(null);
      setDigestMessage(null);
      setAiInsight(null);
    } finally {
      setLatestLoading(false);
    }
  }, []);

  const fetchProposals = useCallback(async () => {
    setProposalsLoading(true);
    try {
      const resp = await http.get("/api/agent/proposals", {
        params: { limit: 50, _t: Date.now() },
      });
      setProposals(Array.isArray(resp.data?.items) ? resp.data.items : []);
    } catch (err) {
      if (err?.response?.status !== 404) {
        message.error(errorMessage(err, "获取审批队列失败"));
      }
      setProposals([]);
    } finally {
      setProposalsLoading(false);
    }
  }, []);

  const fetchEffects = useCallback(async () => {
    setEffectsLoading(true);
    try {
      const [summaryResp, listResp] = await Promise.all([
        http.get("/api/agent/effects/summary", { params: { _t: Date.now() } }),
        http.get("/api/agent/effects", { params: { limit: 10, _t: Date.now() } }),
      ]);
      setEffectsSummary(summaryResp.data || null);
      setRecentEffects(Array.isArray(listResp.data?.items) ? listResp.data.items : []);
    } catch (err) {
      if (err?.response?.status !== 404) {
        message.error(errorMessage(err, "获取效果追踪失败"));
      }
      setEffectsSummary(null);
      setRecentEffects([]);
    } finally {
      setEffectsLoading(false);
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
    void fetchProposals();
    void fetchEffects();
    void fetchActivities();
    void fetchHistory();
  }, [fetchLatest, fetchProposals, fetchEffects, fetchActivities, fetchHistory]);

  // SSE: real-time updates from Agent
  useEffect(() => {
    let es;
    try {
      es = new EventSource("/api/agent/events");
      es.addEventListener("inspection_complete", () => {
        message.info("Agent 巡检已完成，正在刷新...");
        void fetchLatest();
        void fetchProposals();
        void fetchActivities();
        void fetchHistory();
      });
      es.addEventListener("critical_anomaly", (e) => {
        try {
          const data = JSON.parse(e.data);
          message.warning(`严重异常: ${data.title}`);
        } catch (_) {}
      });
      es.addEventListener("proposals_pending", (e) => {
        try {
          const data = JSON.parse(e.data);
          message.info(`${data.count} 条新建议待审批`);
          void fetchProposals();
        } catch (_) {}
      });
    } catch (_) { /* SSE not supported or endpoint unavailable */ }
    return () => { if (es) es.close(); };
  }, [fetchLatest, fetchProposals, fetchActivities, fetchHistory]);

  async function handleApproveProposal(id) {
    try {
      await http.post(`/api/agent/proposals/${id}/approve`);
      message.success("建议已批准并执行");
      void fetchProposals();
      void fetchActivities();
    } catch (err) {
      message.error(errorMessage(err, "批准失败"));
    }
  }

  async function handleRejectProposal(id, reason) {
    try {
      await http.post(`/api/agent/proposals/${id}/reject`, { reason });
      message.success("建议已拒绝");
      void fetchProposals();
    } catch (err) {
      message.error(errorMessage(err, "拒绝失败"));
    }
  }

  async function handleAcknowledgeAnomaly(anomalyId) {
    try {
      await http.post(`/api/agent/anomalies/${anomalyId}/acknowledge`);
      message.success("异常已标记为已处理");
      void fetchLatest();
    } catch (err) {
      message.error(errorMessage(err, "标记失败"));
    }
  }

  async function handleBatchApprove() {
    try {
      const resp = await http.post("/api/agent/proposals/batch-approve");
      message.success(`已批准并执行 ${resp.data?.approved || 0} 条建议`);
      void fetchProposals();
      void fetchEffects();
      void fetchActivities();
    } catch (err) {
      message.error(errorMessage(err, "批量批准失败"));
    }
  }

  async function handleTriggerInspection() {
    setTriggerLoading(true);
    try {
      await http.post("/api/admin/inspection/run", null, {
        params: { _t: Date.now() },
      });
      message.success("巡检已触发，请稍后刷新查看结果");
      setTimeout(() => {
        void fetchLatest();
        void fetchProposals();
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
        digestMessage={digestMessage}
        aiInsight={aiInsight}
      />

      {/* Section E: Approval Queue */}
      <Card
        title={
          <span>
            <ThunderboltOutlined style={{ marginRight: 8, color: "#eb2f96" }} />
            审批队列
            {proposals.filter((p) => p.status === "pending").length > 0 && (
              <Badge
                count={proposals.filter((p) => p.status === "pending").length}
                style={{ marginLeft: 8 }}
              />
            )}
          </span>
        }
        className="agent-dash-card"
        style={{ marginTop: 16 }}
        extra={
          <Button size="small" onClick={fetchProposals} loading={proposalsLoading}>
            刷新
          </Button>
        }
      >
        <ApprovalQueue
          proposals={proposals}
          loading={proposalsLoading}
          onApprove={handleApproveProposal}
          onReject={handleRejectProposal}
          onBatchApprove={handleBatchApprove}
          onRefresh={fetchProposals}
        />
      </Card>

      {/* Section F: Effect Tracking */}
      <Card
        title={
          <span>
            <CheckCircleOutlined style={{ marginRight: 8, color: "#52c41a" }} />
            效果追踪
            {effectsSummary && effectsSummary.total > 0 && (
              <Tag color="green" style={{ marginLeft: 8 }}>
                {effectsSummary.total - effectsSummary.pending} 已评估
              </Tag>
            )}
          </span>
        }
        className="agent-dash-card"
        style={{ marginTop: 16 }}
      >
        <EffectTracker
          summary={effectsSummary}
          recentEffects={recentEffects}
          loading={effectsLoading}
        />
      </Card>

      {/* Quick Reports */}
      <Card
        title={
          <span>
            <DownloadOutlined style={{ marginRight: 8, color: "#1677ff" }} />
            快捷报表
          </span>
        }
        className="agent-dash-card"
        style={{ marginTop: 16 }}
      >
        <Space wrap>
          <Button
            icon={<DownloadOutlined />}
            onClick={() => { window.location.href = "/api/agent/reports/daily-channel"; }}
          >
            每日渠道汇总
          </Button>
          <Button
            icon={<DownloadOutlined />}
            onClick={() => { window.location.href = "/api/agent/reports/weekly-comparison"; }}
          >
            周环比对比
          </Button>
          {latestInspection?.id && (
            <Button
              icon={<DownloadOutlined />}
              onClick={() => { window.location.href = `/api/agent/inspections/${latestInspection.id}/report`; }}
            >
              巡检报告
            </Button>
          )}
        </Space>
      </Card>

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
          <AnomalyList anomalies={anomalies} onAcknowledge={handleAcknowledgeAnomaly} />
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
