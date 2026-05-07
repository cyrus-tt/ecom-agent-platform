import { PlayCircleOutlined, RobotOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Input, Space, Spin, Table, Tag, Typography, message } from "antd";
import { useState } from "react";
import http from "../api/http";

const { Title, Text } = Typography;
const { TextArea } = Input;

let PivotTableUI = null;
try {
  const mod = require("react-pivottable/PivotTableUI");
  PivotTableUI = mod.default || mod;
  require("react-pivottable/pivottable.css");
} catch (_e) {
  PivotTableUI = null;
}

function FallbackTable({ columns, rows }) {
  if (!columns.length) return null;
  const tableColumns = columns.map((col) => ({
    title: col.name,
    dataIndex: col.name,
    key: col.name,
    ellipsis: true,
  }));
  return (
    <Table
      rowKey={(_, i) => i}
      columns={tableColumns}
      dataSource={rows}
      size="small"
      scroll={{ x: "max-content", y: 500 }}
      pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: ["50", "100", "200"] }}
    />
  );
}

export default function BiPage() {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [sql, setSql] = useState("");
  const [pivotConfig, setPivotConfig] = useState({});
  const [title, setTitle] = useState("");
  const [executing, setExecuting] = useState(false);
  const [queryResult, setQueryResult] = useState(null);
  const [pivotState, setPivotState] = useState({});
  const [error, setError] = useState("");

  const handleAsk = async () => {
    const q = question.trim();
    if (!q) { message.warning("请输入数据需求描述"); return; }
    setAsking(true);
    setError("");
    try {
      const resp = await http.post("/api/bi/ask", { question: q });
      if (!resp.data?.ok) { setError(resp.data?.message || "AI 返回异常"); return; }
      setSql(resp.data.sql || "");
      setPivotConfig(resp.data.pivotConfig || {});
      setTitle(resp.data.title || "");
      setQueryResult(null);
      setPivotState({});
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "AI 请求失败");
    } finally {
      setAsking(false);
    }
  };

  const handleExecute = async () => {
    const s = sql.trim();
    if (!s) { message.warning("SQL 不能为空"); return; }
    setExecuting(true);
    setError("");
    try {
      const resp = await http.post("/api/bi/query", { sql: s });
      if (!resp.data?.ok) { setError(resp.data?.message || "查询失败"); return; }
      setQueryResult(resp.data);
      const cfg = pivotConfig || {};
      setPivotState({
        rows: cfg.rows || [],
        cols: cfg.cols || [],
        vals: cfg.vals || [],
        aggregatorName: cfg.aggregatorName || "Sum",
      });
    } catch (err) {
      const msg = err?.response?.data?.message || err.message || "查询失败";
      setError(msg);
    } finally {
      setExecuting(false);
    }
  };

  const pivotData = queryResult?.rows || [];
  const hasPivot = PivotTableUI !== null;

  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <Card className="hero-card">
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <Title level={3} style={{ margin: 0 }}>数据透视</Title>
          <Text type="secondary">用自然语言描述数据需求，AI 生成 SQL 查询，结果以透视表呈现。可手动修改 SQL 和调整透视维度。</Text>
        </Space>
      </Card>

      <Card title={<><RobotOutlined /> 数据需求</>}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Input
            size="large"
            placeholder="例如：女子渠道按品类统计最近 30 天的出库金额和销量"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onPressEnter={handleAsk}
            suffix={
              <Button type="primary" icon={<ThunderboltOutlined />} loading={asking} onClick={handleAsk}>
                生成 SQL
              </Button>
            }
          />
          {title ? <Tag color="blue">{title}</Tag> : null}
        </Space>
      </Card>

      {(sql || error) ? (
        <Card title={<><PlayCircleOutlined /> SQL 查询</>} extra={
          <Space>
            {queryResult ? (
              <>
                <Tag color="green">{queryResult.rowCount} 行</Tag>
                <Tag color="cyan">{queryResult.elapsed_ms}ms</Tag>
              </>
            ) : null}
            <Button type="primary" icon={<PlayCircleOutlined />} loading={executing} onClick={handleExecute} disabled={!sql.trim()}>
              执行查询
            </Button>
          </Space>
        }>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError("")} /> : null}
            <TextArea
              rows={6}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              style={{ fontFamily: "monospace", fontSize: 13 }}
              placeholder="SELECT ... FROM anta_daily.rpt_sales_sku_daily WHERE ..."
            />
          </Space>
        </Card>
      ) : null}

      {executing ? (
        <Card><Spin tip="正在查询..." style={{ display: "block", textAlign: "center", padding: 40 }} /></Card>
      ) : queryResult && pivotData.length > 0 ? (
        <Card title="数据透视" bodyStyle={{ overflow: "auto" }}>
          {hasPivot ? (
            <PivotTableUI
              data={pivotData}
              onChange={(s) => setPivotState(s)}
              {...pivotState}
            />
          ) : (
            <>
              <Alert type="info" showIcon message="react-pivottable 未安装，使用基础表格展示。安装后可拖拽透视。" style={{ marginBottom: 12 }} />
              <FallbackTable columns={queryResult.columns} rows={pivotData} />
            </>
          )}
        </Card>
      ) : queryResult && pivotData.length === 0 ? (
        <Card><Alert type="warning" showIcon message="查询无结果" description="请调整查询条件或修改 SQL 后重试。" /></Card>
      ) : null}
    </Space>
  );
}
