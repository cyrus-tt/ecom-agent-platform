import { DeleteOutlined, PlayCircleOutlined, RobotOutlined, SaveOutlined, TableOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Alert, Button, Card, DatePicker, Input, Modal, Radio, Select, Space, Spin, Table, Tabs, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import http from "../api/http";

const { Title, Text } = Typography;
const { TextArea } = Input;
const { RangePicker } = DatePicker;

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

function ManualPivotTab() {
  const [datasets, setDatasets] = useState([]);
  const [selectedDataset, setSelectedDataset] = useState("daily_sales");
  const [dateRange, setDateRange] = useState([]);
  const [loading, setLoading] = useState(false);
  const [queryResult, setQueryResult] = useState(null);
  const [pivotState, setPivotState] = useState({});
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState([]);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");

  useEffect(() => {
    http.get("/api/bi/datasets").then((r) => setDatasets(r.data?.datasets || [])).catch(() => {});
    loadTemplates();
  }, []);

  const loadTemplates = () => {
    http.get("/api/bi/templates").then((r) => setTemplates(r.data?.templates || [])).catch(() => {});
  };

  const currentDataset = datasets.find((d) => d.key === selectedDataset);

  const handleLoad = async () => {
    const dateFrom = dateRange?.[0]?.format?.("YYYY-MM-DD") || "";
    const dateTo = dateRange?.[1]?.format?.("YYYY-MM-DD") || "";
    if (currentDataset?.needsDateRange && (!dateFrom || !dateTo)) {
      message.warning("请选择日期区间");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const resp = await http.post("/api/bi/dataset", {
        key: selectedDataset,
        date_from: dateFrom,
        date_to: dateTo,
      });
      if (!resp.data?.ok) { setError(resp.data?.message || "加载失败"); return; }
      setQueryResult(resp.data);
      setPivotState({});
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "加载失败");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveTemplate = async () => {
    const name = templateName.trim();
    if (!name) { message.warning("请输入模板名称"); return; }
    try {
      await http.post("/api/bi/templates", {
        name,
        dataset_key: selectedDataset,
        pivotState,
      });
      message.success("模板已保存");
      setSaveModalOpen(false);
      setTemplateName("");
      loadTemplates();
    } catch (err) {
      message.error(err?.response?.data?.message || "保存失败");
    }
  };

  const handleLoadTemplate = (tpl) => {
    setSelectedDataset(tpl.dataset_key || "daily_sales");
    setPivotState(tpl.pivotState || {});
    message.info(`已加载模板「${tpl.name}」，请点"加载数据"刷新数据`);
  };

  const handleDeleteTemplate = async (tpl) => {
    try {
      await http.delete(`/api/bi/templates/${encodeURIComponent(tpl.id)}`);
      message.success("模板已删除");
      loadTemplates();
    } catch (err) {
      message.error("删除失败");
    }
  };

  const pivotData = queryResult?.rows || [];
  const hasPivot = PivotTableUI !== null;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title={<><TableOutlined /> 数据源</>} extra={
        templates.length > 0 ? (
          <Select
            style={{ minWidth: 180 }}
            placeholder="加载已存模板"
            value={undefined}
            onChange={(id) => {
              const tpl = templates.find((t) => t.id === id);
              if (tpl) handleLoadTemplate(tpl);
            }}
            options={templates.map((t) => ({ label: t.name, value: t.id }))}
            dropdownRender={(menu) => (
              <>
                {menu}
                {templates.map((t) => null)}
              </>
            )}
            optionRender={(option) => {
              const tpl = templates.find((t) => t.id === option.value);
              return (
                <Space style={{ width: "100%", justifyContent: "space-between" }}>
                  <span>{option.label}</span>
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(tpl); }}
                  />
                </Space>
              );
            }}
          />
        ) : null
      }>
        <Space wrap size={12}>
          <Radio.Group value={selectedDataset} onChange={(e) => setSelectedDataset(e.target.value)}>
            {datasets.map((d) => (
              <Radio.Button key={d.key} value={d.key}>{d.label}</Radio.Button>
            ))}
          </Radio.Group>
          {currentDataset?.needsDateRange ? (
            <RangePicker
              value={dateRange.length === 2 ? dateRange : null}
              onChange={(values) => setDateRange(Array.isArray(values) && values?.length === 2 ? values : [])}
            />
          ) : null}
          <Button type="primary" icon={<PlayCircleOutlined />} loading={loading} onClick={handleLoad}>
            加载数据
          </Button>
          {queryResult ? (
            <>
              <Tag color="green">{queryResult.rowCount} 行</Tag>
              <Tag color="cyan">{queryResult.elapsed_ms}ms</Tag>
              <Button icon={<SaveOutlined />} onClick={() => { setTemplateName(""); setSaveModalOpen(true); }}>
                保存为模板
              </Button>
            </>
          ) : null}
        </Space>
        {currentDataset ? <div style={{ marginTop: 8 }}><Text type="secondary">{currentDataset.description}</Text></div> : null}
      </Card>

      {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError("")} /> : null}

      {loading ? (
        <Card><Spin tip="正在加载数据..." style={{ display: "block", textAlign: "center", padding: 40 }} /></Card>
      ) : pivotData.length > 0 ? (
        <Card title="数据透视" bodyStyle={{ overflow: "auto" }}>
          {hasPivot ? (
            <PivotTableUI
              data={pivotData}
              onChange={(s) => setPivotState(s)}
              {...pivotState}
            />
          ) : (
            <>
              <Alert type="info" showIcon message="react-pivottable 未安装，使用基础表格。" style={{ marginBottom: 12 }} />
              <FallbackTable columns={queryResult?.columns || []} rows={pivotData} />
            </>
          )}
        </Card>
      ) : queryResult ? (
        <Card><Alert type="warning" showIcon message="数据集为空" description="请调整日期区间或数据集后重试。" /></Card>
      ) : null}

      <Modal
        open={saveModalOpen}
        title="保存透视模板"
        okText="保存"
        onOk={handleSaveTemplate}
        onCancel={() => setSaveModalOpen(false)}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text>将当前的透视维度配置保存为模板，下次可一键加载。</Text>
          <Input placeholder="模板名称（如：女子渠道按品类月度分析）" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
        </Space>
      </Modal>
    </Space>
  );
}

function AiPivotTab() {
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
      setError(err?.response?.data?.message || err.message || "查询失败");
    } finally {
      setExecuting(false);
    }
  };

  const pivotData = queryResult?.rows || [];
  const hasPivot = PivotTableUI !== null;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
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
              <Alert type="info" showIcon message="react-pivottable 未安装，使用基础表格。" style={{ marginBottom: 12 }} />
              <FallbackTable columns={queryResult?.columns || []} rows={pivotData} />
            </>
          )}
        </Card>
      ) : queryResult && pivotData.length === 0 ? (
        <Card><Alert type="warning" showIcon message="查询无结果" description="请调整查询条件或修改 SQL 后重试。" /></Card>
      ) : null}
    </Space>
  );
}

export default function BiPage() {
  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <Card className="hero-card">
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <Title level={3} style={{ margin: 0 }}>数据透视</Title>
          <Text type="secondary">选择数据集拖拽搭建透视表，或用 AI 自然语言生成查询。支持保存常用透视配置为模板。</Text>
        </Space>
      </Card>

      <Tabs
        defaultActiveKey="manual"
        type="card"
        items={[
          {
            key: "manual",
            label: <><TableOutlined /> 手动透视</>,
            children: <ManualPivotTab />,
          },
          {
            key: "ai",
            label: <><RobotOutlined /> AI 透视</>,
            children: <AiPivotTab />,
          },
        ]}
      />
    </Space>
  );
}
