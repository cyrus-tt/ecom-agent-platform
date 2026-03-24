import {
  BarChartOutlined,
  FileTextOutlined,
  LinkOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ShopOutlined,
  TableOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import { Alert, Button, Card, Col, Descriptions, Row, Space, Tag, Typography, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { ADMIN_ACCOUNTS_ROUTE } from "../auth/modules";
import http from "../api/http";

const { Title, Text } = Typography;

const ENTRY_META = {
  report_daily: {
    title: "日报主表",
    path: "/report-daily",
    icon: <TableOutlined />,
    description: "按日期区间筛选主表数据，支持搜索、分页和导出。",
  },
  arrival: {
    title: "新品看板",
    path: "/arrival",
    icon: <InboxOutlined />,
    description: "查看到货执行、库存、入库计划和跟进备注。",
  },
  analysis: {
    title: "经营分析",
    path: "/analysis",
    icon: <FileTextOutlined />,
    description: "生成聚合口径 AI 复盘并回看历史报告。",
  },
  dashboard: {
    title: "数据可视化看板",
    path: "/dashboard",
    icon: <BarChartOutlined />,
    description: "查看趋势、环比和品类结构变化。",
  },
  channel_dashboard: {
    title: "渠道店铺看板",
    path: "/channel-dashboard",
    icon: <ShopOutlined />,
    description: "查看各渠道中类销售 Top 与代表货号明细。",
  },
};

function StatusTag({ ok, text }) {
  return <Tag color={ok ? "success" : "error"}>{text}</Tag>;
}

export default function PortalPage() {
  const { auth, hasPermission, isAdmin } = useAuth();
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pipelineSyncing, setPipelineSyncing] = useState(false);
  const [pipelineStatus, setPipelineStatus] = useState(null);

  useEffect(() => {
    void refreshHealth();
  }, []);

  async function refreshHealth() {
    setLoading(true);
    try {
      const resp = await http.get("/api/health", { params: { _t: Date.now() } });
      setHealth(resp.data || null);
    } catch (err) {
      setHealth({
        ok: false,
        error: err?.response?.data?.message || err.message || "健康检查失败",
      });
    } finally {
      setLoading(false);
    }
  }

  async function pollManagedJob(jobId) {
    while (true) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      const resp = await http.get(`/api/admin/jobs/${encodeURIComponent(jobId)}`, {
        params: { _t: Date.now() },
      });
      const job = resp.data?.job || null;
      if (!job) {
        throw new Error("报表同步任务不存在");
      }
      if (job.status === "running") {
        const lastLog = Array.isArray(job.logs) && job.logs.length ? job.logs[job.logs.length - 1] : "";
        setPipelineStatus({
          type: "info",
          text: lastLog || "后台正在同步销售与库存报表，请稍候...",
        });
        continue;
      }
      if (job.status !== "succeeded") {
        const lastLog = Array.isArray(job.logs) && job.logs.length ? job.logs[job.logs.length - 1] : "";
        throw new Error(job.error || lastLog || "报表同步失败");
      }
      return;
    }
  }

  async function rebuildWeeklyData() {
    if (pipelineSyncing) {
      return;
    }
    setPipelineSyncing(true);
    setPipelineStatus({
      type: "info",
      text: "正在提交销售与库存报表同步任务...",
    });
    try {
      const resp = await http.post("/api/admin/rebuild-weekly");
      const jobId = resp.data?.job?.id;
      if (!jobId) {
        throw new Error(resp.data?.message || "报表同步任务返回异常");
      }
      await pollManagedJob(jobId);
      setPipelineStatus({
        type: "success",
        text: "销售与库存报表同步完成。日报、分析和看板页面重新请求接口后就会显示最新数据。",
      });
      message.success("销售与库存报表同步完成");
      await refreshHealth();
    } catch (err) {
      const errorText = err?.response?.data?.message || err?.message || "报表同步失败";
      setPipelineStatus({
        type: "error",
        text: errorText,
      });
      message.error(errorText);
    } finally {
      setPipelineSyncing(false);
    }
  }

  const entries = useMemo(() => {
    const next = Object.entries(ENTRY_META)
      .filter(([moduleKey]) => hasPermission(moduleKey))
      .map(([moduleKey, item]) => ({
        key: moduleKey,
        ...item,
      }));
    if (isAdmin) {
      next.push({
        key: "admin_accounts",
        title: "账号权限管理",
        path: ADMIN_ACCOUNTS_ROUTE,
        icon: <SafetyCertificateOutlined />,
        description: "查看账号权限范围，直接勾选模块权限并新建子账号。",
      });
    }
    return next;
  }, [hasPermission, isAdmin]);

  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <Card className="hero-card">
        <Title level={2} style={{ marginBottom: 8 }}>
          电商智能运营门户
        </Title>
        <Text type="secondary">统一入口访问你当前账号已获授权的业务板块，并查看系统运行状态。</Text>
        <Descriptions column={{ xs: 1, md: 2 }} style={{ marginTop: 20 }}>
          <Descriptions.Item label="当前账号">{auth?.name || auth?.username || "-"}</Descriptions.Item>
          <Descriptions.Item label="会话退出">
            <a href="/logout">退出登录</a>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {isAdmin ? (
        <Card
          title="报表同步"
          extra={
            <Button type="primary" loading={pipelineSyncing} onClick={() => void rebuildWeeklyData()}>
              同步销售/库存报表
            </Button>
          }
        >
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Text type="secondary">
              把 `data/inbox` 里的最新库存和销售文件导入报表数据库。日报、分析、可视化和渠道页面读取的是数据库结果，不会直接读取原始文件。
            </Text>
            <Alert
              showIcon
              type={pipelineStatus?.type || "info"}
              message={pipelineStatus?.text || "更新原始文件后，需要先执行一次报表同步，前端页面才会看到变化。"}
            />
          </Space>
        </Card>
      ) : null}

      <Row gutter={[16, 16]}>
        {entries.map((item) => (
          <Col key={item.key} xs={24} md={12} xl={8}>
            <Card className="entry-card" title={item.title} extra={item.icon || <LinkOutlined />}>
              <p>{item.description}</p>
              <Button type="primary" href={item.path}>
                进入
              </Button>
            </Card>
          </Col>
        ))}
      </Row>

      <Card
        title="系统健康状态"
        extra={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refreshHealth()}>
            刷新
          </Button>
        }
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type={health?.ok ? "success" : "warning"}
            showIcon
            message={health?.ok ? "系统可用" : "部分模块异常"}
            description={health?.error || "已拆分显示各依赖状态，单个模块异常不会再模糊成整站不可用。"}
          />
          <Descriptions column={{ xs: 1, md: 2, xl: 4 }} bordered size="small">
            <Descriptions.Item label="网关">
              <StatusTag ok={true} text="正常" />
            </Descriptions.Item>
            <Descriptions.Item label="报表数据库">
              <StatusTag ok={health?.report_db?.ok} text={health?.report_db?.ok ? "正常" : health?.report_db?.message || "异常"} />
            </Descriptions.Item>
            <Descriptions.Item label="新品服务">
              <StatusTag ok={health?.upstream?.arrival?.ok} text={health?.upstream?.arrival?.ok ? "正常" : health?.upstream?.arrival?.message || "异常"} />
            </Descriptions.Item>
            <Descriptions.Item label="备注服务">
              <StatusTag ok={health?.upstream?.notes?.ok} text={health?.upstream?.notes?.ok ? "正常" : health?.upstream?.notes?.message || "异常"} />
            </Descriptions.Item>
          </Descriptions>
        </Space>
      </Card>
    </Space>
  );
}
