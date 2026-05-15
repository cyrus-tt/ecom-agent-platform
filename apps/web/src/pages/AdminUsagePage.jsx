import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Segmented, Space, Statistic, Table, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import http from "../api/http";

const { Title, Text } = Typography;

const INTERVAL_OPTIONS = [
  { label: "近 1 小时", value: "1 hour" },
  { label: "近 6 小时", value: "6 hours" },
  { label: "近 24 小时", value: "24 hours" },
  { label: "近 7 天", value: "7 days" },
  { label: "近 30 天", value: "30 days" },
];

function formatTimestamp(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return String(value);
  }
}

function formatNumber(value) {
  if (value == null) return "-";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString("zh-CN");
}

export default function AdminUsagePage() {
  const [interval, setInterval] = useState("24 hours");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState({});
  const [byPath, setByPath] = useState([]);
  const [byUser, setByUser] = useState([]);

  const load = useCallback(async (nextInterval) => {
    setLoading(true);
    setError("");
    try {
      const resp = await http.get("/api/admin/usage", {
        params: { interval: nextInterval, _t: Date.now() },
      });
      if (resp.data?.ok) {
        setSummary(resp.data.summary || {});
        setByPath(Array.isArray(resp.data.by_path) ? resp.data.by_path : []);
        setByUser(Array.isArray(resp.data.by_user) ? resp.data.by_user : []);
      } else {
        setError(resp.data?.message || "用量数据不可用");
        setSummary({});
        setByPath([]);
        setByUser([]);
      }
    } catch (err) {
      const msg = err?.response?.data?.message || err.message || "加载用量数据失败";
      setError(msg);
      setSummary({});
      setByPath([]);
      setByUser([]);
      if (err?.response?.status !== 503) {
        message.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(interval);
  }, [interval, load]);

  const pathColumns = useMemo(
    () => [
      {
        title: "方法",
        dataIndex: "method",
        key: "method",
        width: 80,
        render: (value) => <Tag>{value}</Tag>,
      },
      {
        title: "路径",
        dataIndex: "path",
        key: "path",
        ellipsis: true,
      },
      {
        title: "请求数",
        dataIndex: "total_requests",
        key: "total_requests",
        width: 110,
        sorter: (a, b) => Number(a.total_requests) - Number(b.total_requests),
        defaultSortOrder: "descend",
        render: formatNumber,
      },
      {
        title: "独立用户",
        dataIndex: "unique_users",
        key: "unique_users",
        width: 100,
        render: formatNumber,
      },
      {
        title: "平均耗时 (ms)",
        dataIndex: "avg_duration_ms",
        key: "avg_duration_ms",
        width: 120,
        render: (value) => (value == null ? "-" : formatNumber(value)),
      },
      {
        title: "P95 耗时 (ms)",
        dataIndex: "p95_duration_ms",
        key: "p95_duration_ms",
        width: 120,
        render: (value) => (value == null ? "-" : formatNumber(value)),
      },
      {
        title: "错误数",
        dataIndex: "error_count",
        key: "error_count",
        width: 90,
        render: (value) => {
          const n = Number(value || 0);
          if (!n) return <Text type="secondary">0</Text>;
          return <Tag color={n > 10 ? "red" : "orange"}>{formatNumber(n)}</Tag>;
        },
      },
      {
        title: "最近访问",
        dataIndex: "last_request_at",
        key: "last_request_at",
        width: 170,
        render: formatTimestamp,
      },
    ],
    []
  );

  const userColumns = useMemo(
    () => [
      {
        title: "用户名",
        dataIndex: "username",
        key: "username",
        render: (value, row) => (
          <Space>
            <Text>{value || <Text type="secondary">-</Text>}</Text>
            {row.is_admin ? <Tag color="gold">管理员</Tag> : null}
          </Space>
        ),
      },
      {
        title: "账号 ID",
        dataIndex: "account_id",
        key: "account_id",
        width: 260,
        ellipsis: true,
        render: (value) => <Text code>{value || "-"}</Text>,
      },
      {
        title: "请求数",
        dataIndex: "total_requests",
        key: "total_requests",
        width: 110,
        sorter: (a, b) => Number(a.total_requests) - Number(b.total_requests),
        defaultSortOrder: "descend",
        render: formatNumber,
      },
      {
        title: "访问路径数",
        dataIndex: "unique_paths",
        key: "unique_paths",
        width: 110,
        render: formatNumber,
      },
      {
        title: "错误数",
        dataIndex: "error_count",
        key: "error_count",
        width: 90,
        render: (value) => {
          const n = Number(value || 0);
          if (!n) return <Text type="secondary">0</Text>;
          return <Tag color={n > 10 ? "red" : "orange"}>{formatNumber(n)}</Tag>;
        },
      },
      {
        title: "最近活跃",
        dataIndex: "last_request_at",
        key: "last_request_at",
        width: 170,
        render: formatTimestamp,
      },
    ],
    []
  );

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <Title level={3} style={{ margin: 0 }}>用量统计</Title>
        <Space>
          <Segmented
            options={INTERVAL_OPTIONS}
            value={interval}
            onChange={(value) => setInterval(String(value))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load(interval)} loading={loading}>
            刷新
          </Button>
        </Space>
      </div>

      {error ? (
        <Alert
          type="warning"
          showIcon
          message="用量数据不可用"
          description={error}
        />
      ) : null}

      <Card size="small" title="汇总">
        <Space size={48} wrap>
          <Statistic title="请求总数" value={Number(summary.total_requests || 0)} />
          <Statistic title="独立用户" value={Number(summary.unique_users || 0)} />
          <Statistic title="4xx 错误" value={Number(summary.client_errors || 0)} />
          <Statistic title="5xx 错误" value={Number(summary.server_errors || 0)} valueStyle={{ color: Number(summary.server_errors || 0) > 0 ? "#cf1322" : undefined }} />
          <Statistic title="平均耗时 (ms)" value={Number(summary.avg_duration_ms || 0)} />
        </Space>
      </Card>

      <Card size="small" title={`按路径 Top ${byPath.length}`}>
        <Table
          size="small"
          loading={loading}
          rowKey={(row) => `${row.method}__${row.path}`}
          columns={pathColumns}
          dataSource={byPath}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          scroll={{ x: 1000 }}
        />
      </Card>

      <Card size="small" title={`按用户 Top ${byUser.length}`}>
        <Table
          size="small"
          loading={loading}
          rowKey={(row) => row.account_id || row.username || Math.random()}
          columns={userColumns}
          dataSource={byUser}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          scroll={{ x: 900 }}
        />
      </Card>

      <Alert
        type="info"
        showIcon
        message="关于数据"
        description={
          <Space direction="vertical" size={4}>
            <Text type="secondary">
              数据来自 anta_daily.audit_log 表，由每次 API 请求写入（PR7 起）。
            </Text>
            <Text type="secondary">
              /healthz、/readyz、/api/ping、/api/metrics、静态资源不计入审计。
            </Text>
          </Space>
        }
      />
    </div>
  );
}
