import { ArrowDownOutlined, ArrowRightOutlined, ArrowUpOutlined } from "@ant-design/icons";
import { Button, Card, Col, DatePicker, Drawer, Empty, Row, Select, Space, Spin, Statistic, Table, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import http from "../api/http";
import { useAuth } from "../auth/AuthContext";
import ChannelCompareSection from "../components/ChannelCompareSection";
import SkuPreview from "../components/SkuPreview";
import { formatPercent, formatSmartNumber, formatTextOrDash, TABLE_NUMBER_ALIGN } from "../utils/numbers";

const { RangePicker } = DatePicker;
const { Title, Text } = Typography;
const DRILLDOWN_DEFAULT_PAGE_SIZE = 20;
const DRILLDOWN_PAGE_SIZE_OPTIONS = ["20", "50", "100"];
const MAX_COMPARE_CHANNELS = 2;

function createEmptyDrilldownState() {
  return { open: false, loading: false, category: "", level: "style", style: "", meta: null, summary: null, items: [], total: 0, page: 1, pageSize: DRILLDOWN_DEFAULT_PAGE_SIZE };
}
function formatNumber(value, digits = 2) { return formatSmartNumber(value, digits); }
function formatRatio(value) { return formatPercent(value, 2); }
function renderChangeNode(value) {
  if (value === null || value === undefined) return <Tag color="default">N/A</Tag>;
  const number = Number(value);
  if (!Number.isFinite(number)) return <Tag color="default">N/A</Tag>;
  const icon = number > 0 ? <ArrowUpOutlined /> : number < 0 ? <ArrowDownOutlined /> : <ArrowRightOutlined />;
  const color = number > 0 ? "#d4380d" : number < 0 ? "#389e0d" : "#8c8c8c";
  return <span style={{ color }}>{icon} {(number * 100).toFixed(2)}%</span>;
}
function buildLineOption(data) {
  return { tooltip: { trigger: "axis" }, legend: { top: 0, textStyle: { color: "#1f2a44" } }, grid: { left: 48, right: 20, top: 40, bottom: 36 }, xAxis: { type: "category", data: data.map((item) => item.date), axisLabel: { color: "#54627a", hideOverlap: true } }, yAxis: [{ type: "value", name: "出库金额", axisLabel: { color: "#54627a" } }, { type: "value", name: "销量", axisLabel: { color: "#54627a" } }], series: [{ type: "line", name: "出库金额", smooth: true, showSymbol: false, lineStyle: { width: 3, color: "#1467ff" }, areaStyle: { color: "rgba(20,103,255,0.12)" }, data: data.map((item) => Number(item.gmv || 0)) }, { type: "line", name: "销量", smooth: true, yAxisIndex: 1, showSymbol: false, lineStyle: { width: 2, color: "#00a2ae" }, data: data.map((item) => Number(item.qty || 0)) }] };
}
function buildWeeklyOption(data) {
  return { tooltip: { trigger: "axis" }, legend: { top: 0, textStyle: { color: "#1f2a44" } }, grid: { left: 48, right: 20, top: 40, bottom: 36 }, xAxis: { type: "category", data: data.map((item) => item.week_start), axisLabel: { color: "#54627a", hideOverlap: true } }, yAxis: [{ type: "value", name: "出库金额", axisLabel: { color: "#54627a" } }, { type: "value", name: "销量", axisLabel: { color: "#54627a" } }], series: [{ type: "bar", name: "出库金额", itemStyle: { color: "#3875ff" }, data: data.map((item) => Number(item.gmv || 0)) }, { type: "line", name: "销量", yAxisIndex: 1, smooth: true, lineStyle: { width: 2, color: "#18a999" }, showSymbol: false, data: data.map((item) => Number(item.qty || 0)) }] };
}
function buildStructureOption(data) {
  return { tooltip: { trigger: "axis", axisPointer: { type: "shadow" } }, legend: { top: 0, textStyle: { color: "#1f2a44" } }, grid: { left: 56, right: 20, top: 40, bottom: 36 }, xAxis: { type: "value", axisLabel: { color: "#54627a", formatter: (value) => `${value}%` } }, yAxis: { type: "category", data: data.map((item) => item.category), axisLabel: { color: "#42526e" } }, series: [{ type: "bar", name: "出库金额 占比", itemStyle: { color: "#1967d2" }, data: data.map((item) => Number(item.gmv_share_pct || 0) * 100) }, { type: "bar", name: "库存占比", itemStyle: { color: "#39a845" }, data: data.map((item) => Number(item.inventory_share_pct || 0) * 100) }] };
}
function KpiCard({ title, metric, ratio = false }) {
  return <Card className="kpi-card" bordered={false}><Statistic title={title} value={ratio ? formatRatio(metric?.current) : formatNumber(metric?.current)} /><div className="kpi-subline"><div>对比变化 {renderChangeNode(metric?.change_pct)}</div><div>对比期 {ratio ? formatRatio(metric?.previous) : formatNumber(metric?.previous)}</div></div></Card>;
}
function getDrilldownLevelLabel(level) { return level === "sku" ? "货号" : "款号"; }
function buildRangeFromTexts(dateFromText, dateToText) { return dateFromText && dateToText ? [dayjs(String(dateFromText), "YYYY-MM-DD"), dayjs(String(dateToText), "YYYY-MM-DD")] : []; }
function buildDefaultDateRange(dateTexts, dateFromText, dateToText) {
  const explicitRange = buildRangeFromTexts(dateFromText, dateToText);
  if (explicitRange.length === 2) return explicitRange;
  const sorted = Array.from(new Set((Array.isArray(dateTexts) ? dateTexts : []).filter(Boolean))).sort();
  if (!sorted.length) return [];
  const endIndex = sorted.length - 1;
  const startIndex = Math.max(0, endIndex - 6);
  return [dayjs(sorted[startIndex], "YYYY-MM-DD"), dayjs(sorted[endIndex], "YYYY-MM-DD")];
}
function normalizePickerRange(values) { return Array.isArray(values) && values.length === 2 && values[0] && values[1] ? values : []; }
function formatRangeText(values) { return Array.isArray(values) && values.length === 2 && values[0] && values[1] ? `${values[0].format("YYYY-MM-DD")} ~ ${values[1].format("YYYY-MM-DD")}` : "-"; }

export default function DashboardPage() {
  const { auth } = useAuth();
  const [dates, setDates] = useState([]);
  const [anchorDate, setAnchorDate] = useState("");
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewDraftRange, setOverviewDraftRange] = useState([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareData, setCompareData] = useState(null);
  const [compareDraftRange, setCompareDraftRange] = useState([]);
  const [compareDraftChannels, setCompareDraftChannels] = useState([]);
  const [drilldown, setDrilldown] = useState(createEmptyDrilldownState);
  const drilldownRequestRef = useRef(0);
  const [filterOptions, setFilterOptions] = useState({ channels: [], categories: [] });
  const [draftChannels, setDraftChannels] = useState([]);
  const [draftMajorCategory, setDraftMajorCategory] = useState("");
  const [draftCategory, setDraftCategory] = useState("");
  const [appliedFilter, setAppliedFilter] = useState({ channels: [], majorCategory: "", category: "" });

  useEffect(() => { void loadDates(); }, []);

  const resetDrilldown = () => {
    drilldownRequestRef.current += 1;
    setDrilldown(createEmptyDrilldownState());
  };
  const closeDrilldown = () => { resetDrilldown(); };

  const loadOverview = async (nextRange, filter = appliedFilter) => {
    const start = nextRange?.[0]?.format?.("YYYY-MM-DD") || "";
    const end = nextRange?.[1]?.format?.("YYYY-MM-DD") || start;
    if (!start || !end) return;
    setOverviewLoading(true);
    try {
      const params = { date_from: start, date_to: end, _t: Date.now() };
      if (filter.channels?.length) params.channels = filter.channels.join(",");
      if (filter.majorCategory) params.major_category = filter.majorCategory;
      if (filter.category) params.category = filter.category;
      const resp = await http.get("/api/dashboard/overview", { params });
      const payload = resp.data || null;
      setOverview(payload);
      setAnchorDate(String(payload?.meta?.anchor_date || payload?.date_to || end));
      setOverviewDraftRange(buildRangeFromTexts(String(payload?.date_from || start), String(payload?.date_to || end)));
    } catch (err) {
      message.error(err?.response?.data?.message || err.message || "读取可视化看板失败");
    } finally {
      setOverviewLoading(false);
    }
  };

  const loadCompareData = async ({ nextRange, nextChannels }) => {
    const start = nextRange?.[0]?.format?.("YYYY-MM-DD") || "";
    const end = nextRange?.[1]?.format?.("YYYY-MM-DD") || start;
    if (!start || !end) return;
    setCompareLoading(true);
    try {
      const resp = await http.get("/api/dashboard/channel-compare", { params: { date_from: start, date_to: end, channels: Array.isArray(nextChannels) && nextChannels.length ? nextChannels.join(",") : undefined, _t: Date.now() } });
      const payload = resp.data || null;
      setCompareData(payload);
      setCompareDraftRange(buildRangeFromTexts(String(payload?.date_from || start), String(payload?.date_to || end)));
      setCompareDraftChannels(Array.isArray(payload?.selected_channels) ? payload.selected_channels : []);
    } catch (err) {
      message.error(err?.response?.data?.message || err.message || "读取渠道对比数据失败");
    } finally {
      setCompareLoading(false);
    }
  };

  const loadDates = async () => {
    try {
      const [datesResp, filterResp] = await Promise.all([
        http.get("/api/dashboard/dates", { params: { _t: Date.now() } }),
        http.get("/api/dashboard/filter-options", { params: { _t: Date.now() } }).catch(() => ({ data: {} })),
      ]);
      const list = Array.isArray(datesResp.data?.sales_dates) ? datesResp.data.sales_dates : Array.isArray(datesResp.data?.anchor_dates) ? datesResp.data.anchor_dates : [];
      const defaultRange = buildDefaultDateRange(list, datesResp.data?.default_date_from, datesResp.data?.default_date_to);
      const channels = Array.isArray(filterResp.data?.channels) ? filterResp.data.channels : [];
      const categories = Array.isArray(filterResp.data?.categories) ? filterResp.data.categories : [];
      setDates(list);
      setFilterOptions({ channels, categories });
      const defaultChannels = Array.isArray(auth?.defaultChannels) && auth.defaultChannels.length > 0 ? auth.defaultChannels : [];
      setDraftChannels(defaultChannels);
      const initFilter = { channels: defaultChannels, majorCategory: "", category: "" };
      setAppliedFilter(initFilter);
      setOverviewDraftRange(defaultRange);
      setCompareDraftRange(defaultRange);
      setAnchorDate(defaultRange?.[1]?.format?.("YYYY-MM-DD") || "");
      resetDrilldown();
      if (defaultRange.length === 2) {
        void loadOverview(defaultRange, initFilter);
        void loadCompareData({ nextRange: defaultRange, nextChannels: [] });
      }
    } catch (err) {
      message.error(err?.response?.data?.message || err.message || "读取看板日期失败");
    }
  };

  const handleApplyOverviewFilters = async () => {
    if (overviewDraftRange.length !== 2) { message.error("请选择完整的可视化日期区间"); return; }
    closeDrilldown();
    const nextFilter = { channels: draftChannels, majorCategory: draftMajorCategory, category: draftCategory };
    setAppliedFilter(nextFilter);
    await loadOverview(overviewDraftRange, nextFilter);
  };
  const handleResetOverviewFilters = async () => {
    const defaultRange = buildDefaultDateRange(dates);
    const defaultChannels = Array.isArray(auth?.defaultChannels) && auth.defaultChannels.length > 0 ? auth.defaultChannels : [];
    setOverviewDraftRange(defaultRange);
    setDraftChannels(defaultChannels);
    setDraftMajorCategory("");
    setDraftCategory("");
    const nextFilter = { channels: defaultChannels, majorCategory: "", category: "" };
    setAppliedFilter(nextFilter);
    closeDrilldown();
    if (defaultRange.length === 2) await loadOverview(defaultRange, nextFilter);
  };
  const handleApplyCompareFilters = async () => {
    if (compareDraftRange.length !== 2) { message.error("请选择完整的渠道对比区间"); return; }
    await loadCompareData({ nextRange: compareDraftRange, nextChannels: compareDraftChannels });
  };
  const handleResetCompareFilters = async () => {
    const defaultRange = buildDefaultDateRange(dates);
    setCompareDraftRange(defaultRange);
    setCompareDraftChannels([]);
    if (defaultRange.length === 2) await loadCompareData({ nextRange: defaultRange, nextChannels: [] });
    else setCompareData(null);
  };

  const loadDrilldown = async ({ category, level, style = "", page = 1, pageSize = DRILLDOWN_DEFAULT_PAGE_SIZE }) => {
    const safeCategory = String(category || "").trim();
    const safeLevel = String(level || "").trim().toLowerCase();
    const safeStyle = String(style || "").trim();
    const appliedDateFrom = String(overview?.date_from || "");
    const appliedDateTo = String(overview?.date_to || "");
    if (!appliedDateFrom || !appliedDateTo || !safeCategory || (safeLevel !== "style" && safeLevel !== "sku")) return;
    const requestId = drilldownRequestRef.current + 1;
    drilldownRequestRef.current = requestId;
    setDrilldown({ open: true, loading: true, category: safeCategory, level: safeLevel, style: safeStyle, meta: null, summary: null, items: [], total: 0, page, pageSize });
    try {
      const drillParams = { anchor_date: anchorDate || undefined, date_from: appliedDateFrom, date_to: appliedDateTo, category: safeCategory, level: safeLevel, style: safeLevel === "sku" ? safeStyle : undefined, page, pageSize, _t: Date.now() };
      if (appliedFilter.channels?.length) drillParams.channels = appliedFilter.channels.join(",");
      const resp = await http.get("/api/dashboard/drilldown", { params: drillParams });
      if (drilldownRequestRef.current !== requestId) return;
      setDrilldown({ open: true, loading: false, category: safeCategory, level: safeLevel, style: safeStyle, meta: resp.data?.meta || null, summary: resp.data?.summary || null, items: Array.isArray(resp.data?.items) ? resp.data.items : [], total: Number(resp.data?.total || 0), page: Number(resp.data?.page || page), pageSize: Number(resp.data?.pageSize || pageSize) });
    } catch (err) {
      if (drilldownRequestRef.current !== requestId) return;
      setDrilldown((prev) => ({ ...prev, loading: false }));
      message.error(err?.response?.data?.message || err.message || "读取下钻明细失败");
    }
  };

  const openCategoryDrilldown = (category) => { void loadDrilldown({ category, level: "style", style: "", page: 1, pageSize: drilldown.pageSize || DRILLDOWN_DEFAULT_PAGE_SIZE }); };
  const openSkuDrilldown = (style) => { void loadDrilldown({ category: drilldown.category, level: "sku", style, page: 1, pageSize: drilldown.pageSize || DRILLDOWN_DEFAULT_PAGE_SIZE }); };
  const backToStyleDrilldown = () => { void loadDrilldown({ category: drilldown.category, level: "style", style: "", page: 1, pageSize: drilldown.pageSize || DRILLDOWN_DEFAULT_PAGE_SIZE }); };
  const structureChartEvents = useMemo(() => ({ click: (params) => { const dataIndex = Number(params?.dataIndex); if (!Number.isInteger(dataIndex) || dataIndex < 0) return; const category = overview?.category_structure?.[dataIndex]?.category; if (category) openCategoryDrilldown(category); } }), [overview, drilldown.pageSize]);
  const renderCategoryAction = (category) => <Button type="link" size="small" style={{ paddingInline: 0, height: "auto" }} onClick={(event) => { event.stopPropagation(); openCategoryDrilldown(category); }}>{formatTextOrDash(category)}</Button>;

  const categoryColumns = useMemo(() => [
    { title: "品类", dataIndex: "category", key: "category", render: (value) => renderCategoryAction(value) },
    { title: "出库金额", dataIndex: "gmv", key: "gmv", align: TABLE_NUMBER_ALIGN, render: (value) => formatNumber(value) },
    { title: "出库金额占比", dataIndex: "gmv_share_pct", key: "gmv_share_pct", align: TABLE_NUMBER_ALIGN, render: (value) => formatRatio(value) },
    { title: "库存", dataIndex: "inventory_qty", key: "inventory_qty", align: TABLE_NUMBER_ALIGN, render: (value) => formatNumber(value) },
    { title: "库存占比", dataIndex: "inventory_share_pct", key: "inventory_share_pct", align: TABLE_NUMBER_ALIGN, render: (value) => formatRatio(value) },
  ], [drilldown.pageSize]);
  const movementColumns = useMemo(() => [
    { title: "品类", dataIndex: "category", key: "category", render: (value) => renderCategoryAction(value) },
    { title: "本期出库金额", dataIndex: "gmv", key: "gmv", align: TABLE_NUMBER_ALIGN, render: (value) => formatNumber(value) },
    { title: "对比期出库金额", dataIndex: "gmv_prev", key: "gmv_prev", align: TABLE_NUMBER_ALIGN, render: (value) => formatNumber(value) },
    { title: "变化率", dataIndex: "gmv_chg_pct", key: "gmv_chg_pct", align: TABLE_NUMBER_ALIGN, render: (value) => renderChangeNode(value) },
  ], [drilldown.pageSize]);
  const styleColumns = useMemo(() => [
    { title: "款号", dataIndex: "style", key: "style", render: (value) => <Button type="link" size="small" style={{ paddingInline: 0, height: "auto" }} onClick={(event) => { event.stopPropagation(); openSkuDrilldown(value); }}>{formatTextOrDash(value)}</Button> },
    { title: "出库金额", dataIndex: "gmv", key: "gmv", align: TABLE_NUMBER_ALIGN, render: (value) => formatNumber(value) },
    { title: "销量", dataIndex: "qty", key: "qty", align: TABLE_NUMBER_ALIGN, render: (value) => formatNumber(value) },
    { title: "库存", dataIndex: "inventory_qty", key: "inventory_qty", align: TABLE_NUMBER_ALIGN, render: (value) => formatNumber(value) },
    { title: "折扣率", dataIndex: "discount_rate", key: "discount_rate", align: TABLE_NUMBER_ALIGN, render: (value) => formatRatio(value) },
    { title: "售罄率", dataIndex: "sell_through", key: "sell_through", align: TABLE_NUMBER_ALIGN, render: (value) => formatRatio(value) },
  ], [drilldown.category, drilldown.pageSize]);
  const skuColumns = useMemo(() => [
    { title: "款号", dataIndex: "style", key: "style", width: 120, render: (value) => formatTextOrDash(value) },
    { title: "货号", dataIndex: "sku", key: "sku", width: 140, render: (value) => <SkuPreview sku={value} text={formatTextOrDash(value)} /> },
    { title: "品名", dataIndex: "product_name", key: "product_name", render: (value) => formatTextOrDash(value) },
    { title: "吊牌价", dataIndex: "tag_price", key: "tag_price", align: TABLE_NUMBER_ALIGN, render: (value) => formatNumber(value) },
    { title: "出库金额", dataIndex: "gmv", key: "gmv", align: TABLE_NUMBER_ALIGN, render: (value) => formatNumber(value) },
    { title: "销量", dataIndex: "qty", key: "qty", align: TABLE_NUMBER_ALIGN, render: (value) => formatNumber(value) },
    { title: "库存", dataIndex: "inventory_qty", key: "inventory_qty", align: TABLE_NUMBER_ALIGN, render: (value) => formatNumber(value) },
    { title: "折扣率", dataIndex: "discount_rate", key: "discount_rate", align: TABLE_NUMBER_ALIGN, render: (value) => formatRatio(value) },
    { title: "售罄率", dataIndex: "sell_through", key: "sell_through", align: TABLE_NUMBER_ALIGN, render: (value) => formatRatio(value) },
  ], []);
  const disabledDate = (value) => !value || dates.length === 0 ? false : !dates.includes(value.format("YYYY-MM-DD"));
  const compareChannelOptions = useMemo(() => (Array.isArray(compareData?.available_channels) ? compareData.available_channels : []).map((item) => ({ label: item.label, value: item.code })), [compareData]);
  const compareChannels = Array.isArray(compareData?.channels) ? compareData.channels : [];
  const overviewAppliedRange = overview?.date_from && overview?.date_to ? `${overview.date_from} ~ ${overview.date_to}` : "-";
  const overviewComparisonRange = overview?.comparison_from && overview?.comparison_to ? `${overview.comparison_from} ~ ${overview.comparison_to}` : "-";
  const compareAppliedRange = compareData?.date_from && compareData?.date_to ? `${compareData.date_from} ~ ${compareData.date_to}` : "-";
  const compareReferenceRange = compareData?.comparison_from && compareData?.comparison_to ? `${compareData.comparison_from} ~ ${compareData.comparison_to}` : "-";
  const drilldownLevelLabel = getDrilldownLevelLabel(drilldown.level);
  const drilldownColumns = drilldown.level === "sku" ? skuColumns : styleColumns;
  const drilldownRowKey = drilldown.level === "sku" ? (row) => `${row.style || ""}-${row.sku || ""}` : (row) => `${row.style || ""}`;

  return (
    <>
      <Space direction="vertical" size={20} style={{ width: "100%" }}>
        <Card className="hero-card">
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <Title level={3} style={{ margin: 0 }}>数据可视化看板</Title>
            <Text type="secondary">支持按任意销售日期区间筛选，核心指标默认对比上一段等长区间。</Text>
            <Space wrap size={10}>
              <RangePicker allowClear={false} value={overviewDraftRange.length === 2 ? overviewDraftRange : null} disabledDate={disabledDate} onChange={(values) => setOverviewDraftRange(normalizePickerRange(values))} />
              <Select mode="multiple" style={{ minWidth: 200 }} placeholder="全部渠道" maxTagCount={2} value={draftChannels} options={filterOptions.channels.map((ch) => ({ label: ch.label, value: ch.code }))} onChange={setDraftChannels} allowClear />
              <Select style={{ minWidth: 120 }} placeholder="全部大类" value={draftMajorCategory || undefined} allowClear onChange={(v) => { setDraftMajorCategory(v || ""); setDraftCategory(""); }} options={[...new Set(filterOptions.categories.map((c) => c.major_category))].map((mc) => ({ label: mc, value: mc }))} />
              {draftMajorCategory ? <Select style={{ minWidth: 120 }} placeholder="全部中类" value={draftCategory || undefined} allowClear onChange={(v) => setDraftCategory(v || "")} options={filterOptions.categories.filter((c) => c.major_category === draftMajorCategory).map((c) => ({ label: c.category, value: c.category }))} /> : null}
              <Button type="primary" loading={overviewLoading} onClick={handleApplyOverviewFilters}>应用筛选</Button>
              <Button onClick={handleResetOverviewFilters} disabled={overviewLoading}>重置</Button>
            </Space>
            <Space wrap size={8}>
              <Tag color="blue">当前区间：{overviewAppliedRange}</Tag>
              <Tag color="purple">对比区间：{overviewComparisonRange}</Tag>
              <Tag color="cyan">草稿区间：{formatRangeText(overviewDraftRange)}</Tag>
              <Tag color="gold">结束日期：{anchorDate || "-"}</Tag>
              <Tag color="geekblue">更新时间：{overview?.updated_at ? dayjs(overview.updated_at).format("YYYY-MM-DD HH:mm:ss") : "-"}</Tag>
            </Space>
          </Space>
        </Card>

        {overviewLoading && !overview ? (
          <Card bordered={false}><div className="settings-loading"><Spin tip="正在加载可视化看板..." /></div></Card>
        ) : !overview ? (
          <Card bordered={false}><Empty description="暂无可视化数据" /></Card>
        ) : (
          <Spin spinning={overviewLoading}>
            <Space direction="vertical" size={20} style={{ width: "100%" }}>
              <Row gutter={[16, 16]}>
                <Col xs={24} md={12} xl={6}><KpiCard title="出库金额" metric={overview?.kpis?.gmv} /></Col>
                <Col xs={24} md={12} xl={6}><KpiCard title="销量" metric={overview?.kpis?.qty} /></Col>
                <Col xs={24} md={12} xl={6}><KpiCard title="售罄率" metric={overview?.kpis?.sell_through} ratio /></Col>
                <Col xs={24} md={12} xl={6}><KpiCard title="折扣率" metric={overview?.kpis?.discount_rate} ratio /></Col>
              </Row>

              <Row gutter={[16, 16]}>
                <Col xs={24} xl={12}><Card title="区间日趋势（出库金额 + 销量）" bordered={false}><ReactECharts style={{ height: 320 }} option={buildLineOption(overview?.trends_daily || [])} /></Card></Col>
                <Col xs={24} xl={12}><Card title="区间周趋势（出库金额 + 销量）" bordered={false}><ReactECharts style={{ height: 320 }} option={buildWeeklyOption(overview?.trends_weekly || [])} /></Card></Col>
              </Row>

              <Row gutter={[16, 16]}>
                <Col xs={24} xl={14}><Card title="品类结构（出库金额占比 vs 库存占比）" bordered={false}><ReactECharts style={{ height: 360 }} option={buildStructureOption(overview?.category_structure || [])} onEvents={structureChartEvents} /></Card></Col>
                <Col xs={24} xl={10}><Card title="品类结构明细" bordered={false}><Table rowKey={(row) => row.category} className="app-compact-table" columns={categoryColumns} dataSource={overview?.category_structure || []} pagination={false} size="small" scroll={{ y: 320 }} onRow={(row) => ({ onClick: () => openCategoryDrilldown(row.category), style: { cursor: "pointer" } })} /></Card></Col>
              </Row>

              <Row gutter={[16, 16]}>
                <Col xs={24} xl={12}><Card title="品类上升榜（对比期）" bordered={false}><Table rowKey={(row) => `up-${row.category}`} className="app-compact-table" columns={movementColumns} dataSource={overview?.category_movement?.rising || []} pagination={false} size="small" onRow={(row) => ({ onClick: () => openCategoryDrilldown(row.category), style: { cursor: "pointer" } })} /></Card></Col>
                <Col xs={24} xl={12}><Card title="品类下降榜（对比期）" bordered={false}><Table rowKey={(row) => `down-${row.category}`} className="app-compact-table" columns={movementColumns} dataSource={overview?.category_movement?.falling || []} pagination={false} size="small" onRow={(row) => ({ onClick: () => openCategoryDrilldown(row.category), style: { cursor: "pointer" } })} /></Card></Col>
              </Row>

              <Card bordered={false} size="small" className="dense-card">
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Space wrap size={10} className="compact-toolbar">
                    <RangePicker allowClear={false} value={compareDraftRange.length === 2 ? compareDraftRange : null} disabledDate={disabledDate} onChange={(values) => setCompareDraftRange(normalizePickerRange(values))} />
                    <Select mode="multiple" style={{ minWidth: 320 }} placeholder="选择 1-2 个渠道" maxCount={MAX_COMPARE_CHANNELS} value={compareDraftChannels} options={compareChannelOptions} onChange={(values) => setCompareDraftChannels(Array.isArray(values) ? values.slice(0, MAX_COMPARE_CHANNELS) : [])} />
                    <Button type="primary" loading={compareLoading} onClick={handleApplyCompareFilters}>应用筛选</Button>
                    <Button onClick={handleResetCompareFilters} disabled={compareLoading}>重置</Button>
                    <Tag color="blue">最多 2 个渠道</Tag>
                  </Space>
                  <Space wrap size={8}>
                    <Tag color="geekblue">当前区间：{compareAppliedRange}</Tag>
                    <Tag color="purple">对比区间：{compareReferenceRange}</Tag>
                    <Tag color="cyan">草稿区间：{formatRangeText(compareDraftRange)}</Tag>
                  </Space>
                </Space>
              </Card>

              <ChannelCompareSection title="产品季对比" sectionKey="season" channels={compareChannels} loading={compareLoading} showSummary />
              <ChannelCompareSection title="大类 / 中类对比" sectionKey="category" channels={compareChannels} loading={compareLoading} showSummary />
            </Space>
          </Spin>
        )}
      </Space>

      <Drawer open={drilldown.open} onClose={closeDrilldown} width={960} title={<Space wrap><span>看板下钻明细</span><Tag color="blue">{drilldown.category || "-"}</Tag><Tag color="geekblue">{drilldownLevelLabel}</Tag>{drilldown.level === "sku" ? <Tag color="purple">款号：{drilldown.style || "-"}</Tag> : null}</Space>} extra={drilldown.level === "sku" ? <Button onClick={backToStyleDrilldown} disabled={drilldown.loading}>返回款号层</Button> : null}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Space wrap><Tag color="blue">品类：{drilldown.meta?.category || drilldown.category || "-"}</Tag><Tag color="cyan">日期范围：{drilldown.meta?.date_from || "-"} ~ {drilldown.meta?.date_to || "-"}</Tag><Tag color="gold">当前层级：{drilldownLevelLabel}</Tag></Space>
          <Row gutter={[12, 12]}>
            <Col xs={12} md={6}><Card bordered={false}><Statistic title="出库金额" value={formatNumber(drilldown.summary?.gmv)} /></Card></Col>
            <Col xs={12} md={6}><Card bordered={false}><Statistic title="销量" value={formatNumber(drilldown.summary?.qty)} /></Card></Col>
            <Col xs={12} md={6}><Card bordered={false}><Statistic title="库存" value={formatNumber(drilldown.summary?.inventory_qty)} /></Card></Col>
            <Col xs={12} md={6}><Card bordered={false}><Statistic title="当前层总数" value={formatNumber(drilldown.summary?.row_count, 0)} /></Card></Col>
          </Row>
          <Table rowKey={drilldownRowKey} className="app-compact-table" columns={drilldownColumns} dataSource={drilldown.items} loading={drilldown.loading} locale={{ emptyText: "当前层级暂无数据" }} scroll={{ x: 900 }} pagination={{ current: drilldown.page, pageSize: drilldown.pageSize, total: drilldown.total, showSizeChanger: true, pageSizeOptions: DRILLDOWN_PAGE_SIZE_OPTIONS, showTotal: (total) => `共 ${total} 条` }} onChange={(pagination) => { const nextPageSize = Number(pagination.pageSize || drilldown.pageSize || DRILLDOWN_DEFAULT_PAGE_SIZE); const nextPage = nextPageSize !== drilldown.pageSize ? 1 : Number(pagination.current || 1); void loadDrilldown({ category: drilldown.category, level: drilldown.level, style: drilldown.style, page: nextPage, pageSize: nextPageSize }); }} />
        </Space>
      </Drawer>
    </>
  );
}
