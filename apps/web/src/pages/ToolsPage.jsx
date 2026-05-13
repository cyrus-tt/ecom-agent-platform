import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Radio,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { DownloadOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import ToolFileUpload from "../features/tools/components/ToolFileUpload";
import {
  DISPATCH_DEFAULT_TRANSPORT_MODE,
  DISPATCH_DEMAND_COLUMNS,
  DISPATCH_PHYSICAL_COLUMNS,
  DISPATCH_VIRTUAL_COLUMNS,
  REQUIRED_INPUT_COLUMNS,
  STOCKOUT_DEMAND_COLUMNS,
  STOCKOUT_MERGE_GROUPS,
  STOCKOUT_STOCK_COLUMNS,
} from "../features/tools/config/toolsConfig";
import { dateStamp, downloadCsvRows, downloadWorkbook, ensureColumns, readWorkbookFile } from "../features/tools/shared/excel";
import { getInventoryMeta, getSkusForSource } from "../features/tools/logic/inventory";
import { createRuleTransferPlan, createSingleTransferPlan, parseTransferRuleRows } from "../features/tools/logic/transfer";
import { createWashPlan, getWashCandidateSkus } from "../features/tools/logic/wash";
import { buildDispatchWorkbook, createDispatchPlan } from "../features/tools/logic/dispatchTemplate";
import { buildStockAlertWorkbook, computeStockAlerts } from "../features/tools/logic/stockAlert";
import {
  buildStockoutDemandWorkbook,
  buildStockoutMoveCsvRows,
  buildVmiWorkbook,
  computeStockout,
} from "../features/tools/logic/stockout";

const { Title, Text } = Typography;

function optionList(items) {
  return items.map((value) => ({ value, label: value }));
}

async function readCheckedWorkbook(file, columns, label) {
  const rows = await readWorkbookFile(file);
  ensureColumns(rows, columns, label);
  return rows;
}

export default function ToolsPage() {
  const [inventoryRows, setInventoryRows] = useState([]);
  const [inventoryFileName, setInventoryFileName] = useState("");
  const inventoryMeta = useMemo(() => getInventoryMeta(inventoryRows), [inventoryRows]);
  const poolOptions = useMemo(() => optionList(inventoryMeta.poolNames), [inventoryMeta.poolNames]);
  const skuOptions = useMemo(() => optionList(inventoryMeta.skus), [inventoryMeta.skus]);

  async function handleInventoryUpload(file) {
    try {
      const rows = await readCheckedWorkbook(file, REQUIRED_INPUT_COLUMNS, "库存导出表");
      setInventoryRows(rows);
      setInventoryFileName(file.name);
      message.success(`已加载库存导出表：${rows.length} 行`);
    } catch (err) {
      message.error(err.message || "库存导出表读取失败");
    }
  }

  const inventoryLoaded = inventoryRows.length > 0;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card className="tools-page-title">
        <Title level={3}>小工具</Title>
        <Text type="secondary">本板块仅在浏览器本地处理上传文件，不向网关上传业务明细。</Text>
      </Card>

      <Row gutter={16}>
        <Col xs={24} lg={8}>
          <ToolFileUpload
            title="上传库存导出表"
            description="用于移仓、洗码、断码预警。字段：分配池名称/代码、货号、条码、尺码、可用数。"
            onFile={handleInventoryUpload}
          />
        </Col>
        <Col xs={24} lg={16}>
          <Card size="small" title="库存数据状态" className="tools-status-card">
            {inventoryLoaded ? (
              <Space wrap>
                <Tag color="success">已加载</Tag>
                <Text>{inventoryFileName}</Text>
                <Text type="secondary">{inventoryMeta.rowCount} 行</Text>
                <Text type="secondary">{inventoryMeta.skus.length} 个货号</Text>
                <Text type="secondary">{inventoryMeta.poolNames.length} 个分配池候选</Text>
              </Space>
            ) : (
              <Alert type="info" showIcon message="先上传库存导出表，再使用移仓、洗码、断码预警。" />
            )}
          </Card>
        </Col>
      </Row>

      <Tabs
        destroyOnHidden={false}
        items={[
          {
            key: "transfer",
            label: "移仓",
            children: <TransferTool inventoryRows={inventoryRows} poolOptions={poolOptions} skuOptions={skuOptions} inventoryMeta={inventoryMeta} />,
          },
          {
            key: "wash",
            label: "洗码",
            children: <WashTool inventoryRows={inventoryRows} poolOptions={poolOptions} />,
          },
          {
            key: "dispatch",
            label: "调拨模板",
            children: <DispatchTool />,
          },
          {
            key: "alert",
            label: "断码预警",
            children: <StockAlertTool inventoryRows={inventoryRows} />,
          },
          {
            key: "stockout",
            label: "缺货处理",
            children: <StockoutTool />,
          },
        ]}
      />
    </Space>
  );
}

function TransferTool({ inventoryRows, poolOptions, skuOptions, inventoryMeta }) {
  const [form] = Form.useForm();
  const [ruleRows, setRuleRows] = useState([]);
  const [ruleWarnings, setRuleWarnings] = useState([]);
  const [result, setResult] = useState(null);
  const sourceName = Form.useWatch("sourceName", form);
  const sourceSkus = useMemo(() => (sourceName ? optionList(getSkusForSource(inventoryRows, sourceName)) : skuOptions), [inventoryRows, skuOptions, sourceName]);

  async function handleRuleUpload(file) {
    try {
      const rows = await readWorkbookFile(file);
      const parsed = parseTransferRuleRows(rows);
      setRuleRows(parsed.rules);
      setRuleWarnings(parsed.warnings);
      message.success(`已读取移仓规则：${parsed.rules.length} 行`);
    } catch (err) {
      message.error(err.message || "移仓规则读取失败");
    }
  }

  function handleGenerate() {
    try {
      if (!inventoryRows.length) throw new Error("请先上传库存导出表");
      const values = form.getFieldsValue();
      const hasRules = ruleRows.length > 0 && values.transferMode === "rules";
      const next = hasRules
        ? createRuleTransferPlan({ inventoryRows, rules: ruleRows, remark: values.remark || "" })
        : createSingleTransferPlan({
            inventoryRows,
            sourceName: values.sourceName,
            targetName: values.targetName,
            sku: values.sku || inventoryMeta.singleSku,
            moveMode: values.moveMode,
            qty: values.qty,
            ratio: values.ratio,
            remark: values.remark || "",
          });
      setResult(next);
      message.success(`移仓预览已生成：${next.previewRows.length} 行`);
    } catch (err) {
      message.error(err.message || "移仓预览生成失败");
    }
  }

  function handleDownload() {
    if (!result?.outputRows?.length) {
      message.warning("请先生成移仓预览");
      return;
    }
    const sku = form.getFieldValue("sku") || inventoryMeta.singleSku || "多货号";
    downloadCsvRows(result.outputRows, `移仓单_${sku}_${dateStamp()}.csv`);
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Row gutter={16}>
        <Col xs={24} lg={8}>
          <Card size="small" title="批量规则">
            <ToolFileUpload title="上传移仓规则表" description="可选。上传后切换到批量规则生成。" onFile={handleRuleUpload} />
            {ruleRows.length ? (
              <Alert style={{ marginTop: 12 }} type={ruleWarnings.length ? "warning" : "success"} showIcon message={`已读取 ${ruleRows.length} 条规则`} />
            ) : null}
          </Card>
        </Col>
        <Col xs={24} lg={16}>
          <Card size="small" title="移仓参数">
            <Form
              form={form}
              layout="vertical"
              initialValues={{ transferMode: "single", moveMode: "qty" }}
              className="tools-form-grid"
            >
              <Form.Item name="transferMode" label="生成方式">
                <Radio.Group
                  options={[
                    { label: "单笔", value: "single" },
                    { label: "批量规则", value: "rules", disabled: !ruleRows.length },
                  ]}
                  optionType="button"
                />
              </Form.Item>
              <Form.Item name="sourceName" label="源分配池">
                <AutoComplete options={poolOptions} filterOption={(input, option) => option.value.includes(input)} />
              </Form.Item>
              <Form.Item name="targetName" label="目标分配池">
                <AutoComplete options={poolOptions} filterOption={(input, option) => option.value.includes(input)} />
              </Form.Item>
              <Form.Item name="sku" label="货号">
                <AutoComplete options={sourceSkus} filterOption={(input, option) => option.value.includes(input)} />
              </Form.Item>
              <Form.Item name="moveMode" label="移仓方式">
                <Radio.Group
                  options={[
                    { label: "数量", value: "qty" },
                    { label: "比例", value: "ratio" },
                  ]}
                  optionType="button"
                />
              </Form.Item>
              <Form.Item shouldUpdate noStyle>
                {({ getFieldValue }) =>
                  getFieldValue("moveMode") === "ratio" ? (
                    <Form.Item name="ratio" label="比例(%)">
                      <InputNumber min={0.1} max={100} step={0.1} style={{ width: "100%" }} />
                    </Form.Item>
                  ) : (
                    <Form.Item name="qty" label="数量">
                      <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                    </Form.Item>
                  )
                }
              </Form.Item>
              <Form.Item name="remark" label="备注">
                <Input />
              </Form.Item>
            </Form>
            <ToolActions onGenerate={handleGenerate} onDownload={handleDownload} downloadDisabled={!result?.outputRows?.length} />
          </Card>
        </Col>
      </Row>
      <TransferResult result={result} />
    </Space>
  );
}

function WashTool({ inventoryRows, poolOptions }) {
  const [selectedPools, setSelectedPools] = useState([]);
  const [sku, setSku] = useState("");
  const [remark, setRemark] = useState("洗码");
  const [result, setResult] = useState(null);
  const skuOptions = useMemo(() => optionList(getWashCandidateSkus(inventoryRows, selectedPools)), [inventoryRows, selectedPools]);

  function handleGenerate() {
    try {
      if (!inventoryRows.length) throw new Error("请先上传库存导出表");
      const next = createWashPlan({ inventoryRows, selectedPools, sku, remark });
      setResult(next);
      message.success(`洗码预览已生成：${next.previewRows.length} 行`);
    } catch (err) {
      message.error(err.message || "洗码预览生成失败");
    }
  }

  function handleDownload() {
    if (!result?.outputRows?.length) {
      message.warning("请先生成洗码预览");
      return;
    }
    downloadCsvRows(result.outputRows, `洗码_${sku || "多货号"}_${dateStamp()}.csv`);
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card size="small" title="洗码参数">
        <Row gutter={12}>
          <Col xs={24} md={10}>
            <Text strong>分配池</Text>
            <Select
              mode="multiple"
              value={selectedPools}
              options={poolOptions}
              maxTagCount="responsive"
              onChange={(items) => setSelectedPools(items.slice(0, 4))}
              style={{ width: "100%", marginTop: 8 }}
              placeholder="选择 2-4 个分配池"
            />
          </Col>
          <Col xs={24} md={6}>
            <Text strong>货号</Text>
            <Select value={sku || undefined} options={skuOptions} onChange={setSku} style={{ width: "100%", marginTop: 8 }} placeholder="选择货号" showSearch />
          </Col>
          <Col xs={24} md={5}>
            <Text strong>备注</Text>
            <Input value={remark} onChange={(event) => setRemark(event.target.value)} style={{ marginTop: 8 }} />
          </Col>
          <Col xs={24} md={3} className="tools-action-col">
            <ToolActions compact onGenerate={handleGenerate} onDownload={handleDownload} downloadDisabled={!result?.outputRows?.length} />
          </Col>
        </Row>
      </Card>
      <Table
        size="small"
        rowKey={(row) => `${row.source}-${row.target}-${row.sku}-${row.barcode}-${row.size}-${row.qty}`}
        dataSource={result?.previewRows || []}
        columns={[
          { title: "源分配池", dataIndex: "source" },
          { title: "目标分配池", dataIndex: "target" },
          { title: "货号", dataIndex: "sku", width: 130 },
          { title: "尺码", dataIndex: "size", width: 90 },
          { title: "条码", dataIndex: "barcode", width: 150 },
          { title: "移仓数", dataIndex: "qty", width: 100 },
        ]}
        pagination={{ pageSize: 50, showSizeChanger: true }}
      />
    </Space>
  );
}

function DispatchTool() {
  const [demandRows, setDemandRows] = useState([]);
  const [virtualRows, setVirtualRows] = useState([]);
  const [physicalRows, setPhysicalRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [transportMode, setTransportMode] = useState(DISPATCH_DEFAULT_TRANSPORT_MODE);
  const [result, setResult] = useState(null);

  async function upload(file, columns, label, setter) {
    try {
      const rows = await readCheckedWorkbook(file, columns, label);
      setter(rows);
      if (label === "调拨需求表") setFileName(file.name.replace(/\.[^/.]+$/, ""));
      message.success(`${label}已加载：${rows.length} 行`);
    } catch (err) {
      message.error(err.message || `${label}读取失败`);
    }
  }

  function handleGenerate() {
    try {
      if (!demandRows.length) throw new Error("请先上传调拨需求表");
      if (!virtualRows.length) throw new Error("请先上传虚仓库存表");
      if (!physicalRows.length) throw new Error("请先上传实仓库存表");
      const next = createDispatchPlan({ demandRows, virtualRows, physicalRows, transportMode, fileName });
      setResult(next);
      message.success(`调拨模板预览已生成：${next.previewRows.length} 行`);
    } catch (err) {
      message.error(err.message || "调拨模板预览生成失败");
    }
  }

  async function handleDownload() {
    if (!result?.dispatchLines?.length) {
      message.warning("请先生成调拨预览");
      return;
    }
    const name = fileName || "调拨需求";
    await downloadWorkbook(buildDispatchWorkbook(result.dispatchLines, name), `调拨批量模板_${name}_${dateStamp()}.xlsx`);
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Row gutter={16}>
        <Col xs={24} md={8}>
          <ToolFileUpload title="上传调拨需求表" onFile={(file) => upload(file, DISPATCH_DEMAND_COLUMNS, "调拨需求表", setDemandRows)} />
        </Col>
        <Col xs={24} md={8}>
          <ToolFileUpload title="上传虚仓库存表" onFile={(file) => upload(file, DISPATCH_VIRTUAL_COLUMNS, "虚仓库存表", setVirtualRows)} />
        </Col>
        <Col xs={24} md={8}>
          <ToolFileUpload title="上传实仓库存表" onFile={(file) => upload(file, DISPATCH_PHYSICAL_COLUMNS, "实仓库存表", setPhysicalRows)} />
        </Col>
      </Row>
      <Card size="small">
        <Space wrap>
          <Text>运输方式</Text>
          <Select
            value={transportMode}
            onChange={setTransportMode}
            style={{ width: 140 }}
            options={[
              { value: "陆运快递", label: "陆运快递" },
              { value: "航空快递", label: "航空快递" },
            ]}
          />
          <ToolActions compact onGenerate={handleGenerate} onDownload={handleDownload} downloadDisabled={!result?.dispatchLines?.length} />
          {result?.warnings?.length ? <Tag color="orange">警示 {result.warnings.length}</Tag> : null}
        </Space>
      </Card>
      <Table
        size="small"
        rowKey="index"
        dataSource={result?.previewRows || []}
        columns={[
          { title: "状态", dataIndex: "statusLabel", width: 90, render: (text, row) => <Tag color={row.status === "ok" ? "success" : "warning"}>{text}</Tag> },
          { title: "提示", dataIndex: "statusNote", width: 180, ellipsis: true },
          { title: "货号", dataIndex: "sku", width: 130 },
          { title: "尺码", dataIndex: "size", width: 90 },
          { title: "数量", dataIndex: "qty", width: 80 },
          { title: "供应商", dataIndex: "supplier", width: 140, ellipsis: true },
          { title: "需求人", dataIndex: "requester", width: 110 },
          { title: "联系人", dataIndex: "contact", width: 110 },
          { title: "地址", dataIndex: "address", ellipsis: true },
        ]}
        scroll={{ x: 1100 }}
        pagination={{ pageSize: 50, showSizeChanger: true }}
      />
    </Space>
  );
}

function StockAlertTool({ inventoryRows }) {
  const [result, setResult] = useState(null);

  function handleGenerate() {
    try {
      if (!inventoryRows.length) throw new Error("请先上传库存导出表");
      const next = computeStockAlerts(inventoryRows);
      setResult(next);
      if (!next.skuRows.length) {
        message.info("未找到满足门槛的预警数据");
      } else {
        message.success(`断码预警已生成：${next.skuRows.length} 个货号`);
      }
    } catch (err) {
      message.error(err.message || "断码预警生成失败");
    }
  }

  async function handleDownload() {
    if (!result?.skuRows?.length) {
      message.warning("请先生成断码预警");
      return;
    }
    await downloadWorkbook(buildStockAlertWorkbook(result.sizeRows, result.skuRows, result.poolRows), `断码预警_${dateStamp()}.xlsx`);
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card size="small">
        <Space wrap>
          <ToolActions compact onGenerate={handleGenerate} onDownload={handleDownload} downloadDisabled={!result?.skuRows?.length} />
          {result ? (
            <>
              <Tag>货号 {result.skuRows.length}</Tag>
              <Tag color="orange">预警明细 {result.sizeRows.length}</Tag>
            </>
          ) : null}
        </Space>
      </Card>
      <Table
        size="small"
        rowKey="sku"
        dataSource={result?.skuRows || []}
        columns={[
          { title: "预警等级", dataIndex: "level", width: 110, render: (value) => <Tag color={value === "已断码" ? "red" : value === "即将断码" ? "orange" : "green"}>{value}</Tag> },
          { title: "货号", dataIndex: "sku", width: 150 },
          { title: "参与分配池", dataIndex: "eligiblePools", width: 110 },
          { title: "总可用数", dataIndex: "totalAvailable", width: 110 },
          { title: "预警分配池数", dataIndex: "warningPools", width: 120 },
          { title: "已断码", dataIndex: "breakCount", width: 90 },
          { title: "即将断码", dataIndex: "soonCount", width: 100 },
          { title: "预警分配池", dataIndex: "warningPoolNames", ellipsis: true },
        ]}
        pagination={{ pageSize: 50, showSizeChanger: true }}
      />
    </Space>
  );
}

function StockoutTool() {
  const [demandRows, setDemandRows] = useState([]);
  const [stockRows, setStockRows] = useState([]);
  const [merge, setMerge] = useState(STOCKOUT_MERGE_GROUPS[0] || "天旗");
  const [result, setResult] = useState(null);

  async function upload(file, columns, label, setter) {
    try {
      const rows = await readCheckedWorkbook(file, columns, label);
      setter(rows);
      message.success(`${label}已加载：${rows.length} 行`);
    } catch (err) {
      message.error(err.message || `${label}读取失败`);
    }
  }

  function handleGenerate() {
    try {
      if (!demandRows.length) throw new Error("请先上传缺货明细表");
      if (!stockRows.length) throw new Error("请先上传缺货货号分配池明细表");
      const next = computeStockout({ demandRows, stockRows, merge });
      setResult(next);
      message.success(`缺货预览已生成：${next.summaryRows.length} 个货号`);
    } catch (err) {
      message.error(err.message || "缺货预览生成失败");
    }
  }

  async function handleDownload() {
    if (!result?.summaryRows?.length) {
      message.warning("请先生成缺货预览");
      return;
    }
    const stamp = dateStamp();
    if (result.moves.length) {
      downloadCsvRows(buildStockoutMoveCsvRows(result.moves), `缺货移仓_${merge}_${stamp}.csv`);
    }
    if (demandRows.length) {
      await downloadWorkbook(buildStockoutDemandWorkbook(demandRows, result.resultByRowIndex), `缺货明细_原表_${merge}_${stamp}.xlsx`);
    }
    if (result.vmiLines.length) {
      const vmi = buildVmiWorkbook(result.vmiLines, merge, "缺货支持");
      await downloadWorkbook(vmi.workbook, `缺货VMI过账_${merge}_${stamp}.xlsx`);
      if (vmi.missing.length) {
        message.warning(`${vmi.missing.length} 个 VMI 分配池未配置映射`);
      }
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Row gutter={16}>
        <Col xs={24} md={12}>
          <ToolFileUpload title="上传缺货明细表" onFile={(file) => upload(file, STOCKOUT_DEMAND_COLUMNS, "缺货明细表", setDemandRows)} />
        </Col>
        <Col xs={24} md={12}>
          <ToolFileUpload title="上传缺货货号分配池明细表" onFile={(file) => upload(file, STOCKOUT_STOCK_COLUMNS, "缺货货号分配池明细表", setStockRows)} />
        </Col>
      </Row>
      <Card size="small">
        <Space wrap>
          <Text>归并范围</Text>
          <Select value={merge} onChange={setMerge} style={{ width: 160 }} options={STOCKOUT_MERGE_GROUPS.map((item) => ({ value: item, label: item }))} />
          <ToolActions compact onGenerate={handleGenerate} onDownload={handleDownload} downloadDisabled={!result?.summaryRows?.length} />
          {result?.warnings?.length ? <Tag color="orange">警示 {result.warnings.length}</Tag> : null}
          {result?.vmiLines?.length ? <Tag color="blue">VMI {result.vmiLines.length}</Tag> : null}
        </Space>
      </Card>
      <Table
        size="small"
        rowKey="sku"
        dataSource={result?.summaryRows || []}
        columns={[
          { title: "状态", dataIndex: "statusLabel", width: 90, render: (value, row) => <Tag color={row.status === "ok" ? "success" : "warning"}>{value}</Tag> },
          { title: "货号", dataIndex: "sku", width: 150 },
          { title: "缺货数", dataIndex: "totalQty", width: 100 },
          { title: "缺口", dataIndex: "shortageQty", width: 100 },
          { title: "尺码", dataIndex: "sizeText", ellipsis: true },
          { title: "提示", dataIndex: "statusNote", ellipsis: true },
          { title: "VMI", dataIndex: "vmiNeeded", width: 80, render: (value) => (value ? <Tag color="blue">是</Tag> : "-") },
        ]}
        pagination={{ pageSize: 50, showSizeChanger: true }}
      />
    </Space>
  );
}

function TransferResult({ result }) {
  if (!result) return null;
  return (
    <Table
      size="small"
      rowKey={(row) => `${row.source}-${row.target}-${row.sku}-${row.barcode}-${row.size}-${row.alloc}`}
      dataSource={result.previewRows || []}
      columns={[
        { title: "源分配池", dataIndex: "source" },
        { title: "目标分配池", dataIndex: "target" },
        { title: "货号", dataIndex: "sku", width: 130 },
        { title: "尺码", dataIndex: "size", width: 90 },
        { title: "条码", dataIndex: "barcode", width: 150 },
        { title: "可用数", dataIndex: "available", width: 100 },
        { title: "移仓数", dataIndex: "alloc", width: 100 },
        { title: "比例(%)", dataIndex: "ratioPct", width: 100 },
      ]}
      pagination={{ pageSize: 50, showSizeChanger: true }}
    />
  );
}

function ToolActions({ onGenerate, onDownload, downloadDisabled, compact = false }) {
  return (
    <Space className={compact ? "" : "tools-actions"}>
      <Button type="primary" icon={<PlayCircleOutlined />} onClick={onGenerate}>
        生成预览
      </Button>
      <Button icon={<DownloadOutlined />} onClick={onDownload} disabled={downloadDisabled}>
        下载
      </Button>
    </Space>
  );
}
