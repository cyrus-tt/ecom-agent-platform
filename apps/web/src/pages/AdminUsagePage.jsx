// V3 migrated to api/hooks/components — see docs/plans/2026-04-25-v3-frontend-api-layer-plan.md
import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Segmented, Space, Statistic, Tag, Typography } from "antd";
import { useState } from "react";
import { adminApi } from "../api";
import { DataTable, HeroCard, PageHeader } from "../components";
import { useApi } from "../hooks";

const { Text } = Typography;

const INTERVAL_OPTIONS = [
  { label: "近 1 小时", value: "1 hour" },
  { label: "近 6 小时", value: "6 hours" },
  { label: "近 24 小时", value: "24 hours" },
  { label: "近 7 天", value: "7 days" },
  { label: "近 30 天", value: "30 days" },
];

function formatTimestamp(value) {
  if (!value) return "-";
  try { return new Date(value).toLocaleString("zh-CN", { hour12: false }); } catch { return String(value); }
}

function formatNumber(value) {
  if (value == null) return "-";
  const n = Number(value);
  return Number.isNaN(n) ? String(value) : n.toLocaleString("zh-CN");
}

function renderErrorTag(value) {
  const n = Number(value || 0);
  if (!n) return <Text type="secondary">0</Text>;
  return <Tag color={n > 10 ? "red" : "orange"}>{formatNumber(n)}</Tag>;
}

const PATH_COLUMNS = [
  { title: "方法", dataIndex: "method", key: "method", width: 80, render: (v) => <Tag>{v}</Tag> },
  { title: "路径", dataIndex: "path", key: "path", ellipsis: true },
  { title: "请求数", dataIndex: "total_requests", key: "total_requests", width: 110,
    sorter: (a, b) => Number(a.total_requests) - Number(b.total_requests), defaultSortOrder: "descend", render: formatNumber },
  { title: "独立用户", dataIndex: "unique_users", key: "unique_users", width: 100, render: formatNumber },
  { title: "平均耗时 (ms)", dataIndex: "avg_duration_ms", key: "avg_duration_ms", width: 120, render: (v) => v == null ? "-" : formatNumber(v) },
  { title: "P95 耗时 (ms)", dataIndex: "p95_duration_ms", key: "p95_duration_ms", width: 120, render: (v) => v == null ? "-" : formatNumber(v) },
  { title: "错误数", dataIndex: "error_count", key: "error_count", width: 90, render: renderErrorTag },
  { title: "最近访问", dataIndex: "last_request_at", key: "last_request_at", width: 170, render: formatTimestamp },
];

const USER_COLUMNS = [
  { title: "用户名", dataIndex: "username", key: "username",
    render: (v, row) => (
      <Space>
        <Text>{v || <Text type="secondary">-</Text>}</Text>
        {row.is_admin ? <Tag color="gold">管理员</Tag> : null}
      </Space>
    ) },
  { title: "账号 ID", dataIndex: "account_id", key: "account_id", width: 260, ellipsis: true, render: (v) => <Text code>{v || "-"}</Text> },
  { title: "请求数", dataIndex: "total_requests", key: "total_requests", width: 110,
    sorter: (a, b) => Number(a.total_requests) - Number(b.total_requests), defaultSortOrder: "descend", render: formatNumber },
  { title: "访问路径数", dataIndex: "unique_paths", key: "unique_paths", width: 110, render: formatNumber },
  { title: "错误数", dataIndex: "error_count", key: "error_count", width: 90, render: renderErrorTag },
  { title: "最近活跃", dataIndex: "last_request_at", key: "last_request_at", width: 170, render: formatTimestamp },
];

export default function AdminUsagePage() {
  const [interval, setInterval] = useState("24 hours");
  const [unavailableMsg, setUnavailableMsg] = useState("");

  const { data, loading, refetch } = useApi(
    () => adminApi.getUsage({ interval }),
    [interval],
    {
      silentError: true,
      onSuccess: (resp) => setUnavailableMsg(resp?.ok ? "" : resp?.message || "用量数据不可用"),
      onError: (err) => setUnavailableMsg(err?.response?.data?.message || err?.message || "加载用量数据失败"),
    }
  );

  const summary = data?.ok ? data.summary || {} : {};
  const byPath = data?.ok && Array.isArray(data.by_path) ? data.by_path : [];
  const byUser = data?.ok && Array.isArray(data.by_user) ? data.by_user : [];

  const headerActions = (
    <Space>
      <Segmented options={INTERVAL_OPTIONS} value={interval} onChange={(v) => setInterval(String(v))} />
      <Button icon={<ReloadOutlined />} onClick={() => void refetch()} loading={loading}>刷新</Button>
    </Space>
  );

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <HeroCard><PageHeader title="用量统计" actions={headerActions} /></HeroCard>

      {unavailableMsg ? <Alert type="warning" showIcon message="用量数据不可用" description={unavailableMsg} /> : null}

      <Card size="small" title="汇总">
        <Space size={48} wrap>
          <Statistic title="请求总数" value={Number(summary.total_requests || 0)} />
          <Statistic title="独立用户" value={Number(summary.unique_users || 0)} />
          <Statistic title="4xx 错误" value={Number(summary.client_errors || 0)} />
          <Statistic title="5xx 错误" value={Number(summary.server_errors || 0)}
            valueStyle={{ color: Number(summary.server_errors || 0) > 0 ? "#cf1322" : undefined }} />
          <Statistic title="平均耗时 (ms)" value={Number(summary.avg_duration_ms || 0)} />
        </Space>
      </Card>

      <Card size="small" title={`按路径 Top ${byPath.length}`}>
        <DataTable rowKey={(row) => `${row.method}__${row.path}`} columns={PATH_COLUMNS}
          dataSource={byPath} loading={loading}
          pagination={{ pageSize: 20, hideOnSinglePage: true }} scroll={{ x: 1000 }} />
      </Card>

      <Card size="small" title={`按用户 Top ${byUser.length}`}>
        <DataTable rowKey={(row) => row.account_id || row.username || Math.random()} columns={USER_COLUMNS}
          dataSource={byUser} loading={loading}
          pagination={{ pageSize: 20, hideOnSinglePage: true }} scroll={{ x: 900 }} />
      </Card>

      <Alert type="info" showIcon message="关于数据"
        description={
          <Space direction="vertical" size={4}>
            <Text type="secondary">数据来自 anta_daily.audit_log 表，由每次 API 请求写入（PR7 起）。</Text>
            <Text type="secondary">/healthz、/readyz、/api/ping、/api/metrics、静态资源不计入审计。</Text>
          </Space>
        } />
    </div>
  );
}
