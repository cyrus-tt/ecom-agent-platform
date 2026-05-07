import { Button, Card, DatePicker, Empty, Select, Space, Spin, Statistic, Table, Tabs, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";
import http from "../api/http";
import { useAuth } from "../auth/AuthContext";
import SkuPreview from "../components/SkuPreview";
import {
  formatInteger,
  formatDecimal,
  formatPercent,
  formatPercentInteger,
  formatTextOrDash,
  formatWan,
  TABLE_NUMBER_ALIGN,
} from "../utils/numbers";

const { RangePicker } = DatePicker;
const { Title, Text } = Typography;
const MAX_CHANNELS = 4;

function normalizePickerRange(values) {
  if (!Array.isArray(values) || values.length !== 2 || !values[0] || !values[1]) {
    return [];
  }
  return values;
}

function toRangeText(values) {
  if (!Array.isArray(values) || values.length !== 2 || !values[0] || !values[1]) {
    return "-";
  }
  return `${values[0].format("YYYY-MM-DD")} ~ ${values[1].format("YYYY-MM-DD")}`;
}

function toOptionalRangeText(values) {
  if (!Array.isArray(values) || values.length !== 2 || !values[0] || !values[1]) {
    return "未选择同期";
  }
  return toRangeText(values);
}

function calcPercentChange(current, previous) {
  const currentValue = Number(current);
  const previousValue = Number(previous);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) {
    return null;
  }
  if (Math.abs(previousValue) < 1e-9) {
    return Math.abs(currentValue) < 1e-9 ? 0 : null;
  }
  return (currentValue - previousValue) / Math.abs(previousValue);
}

function renderComparisonTag(label, current, previous) {
  const change = calcPercentChange(current, previous);
  if (change === null) {
    return <Tag color="default">{label} N/A</Tag>;
  }
  const prefix = change > 0 ? "+" : "";
  const color = change > 0 ? "red" : change < 0 ? "green" : "default";
  return <Tag color={color}>{label} {prefix}{formatPercent(change, 1)}</Tag>;
}

function buildStyleDrilldownTableKey(channelCode, periodKey) {
  return `${String(channelCode || "").trim()}::${String(periodKey || "").trim()}`;
}

function buildStyleDrilldownCacheKey(channelCode, periodKey, style) {
  return `${buildStyleDrilldownTableKey(channelCode, periodKey)}::${String(style || "").trim()}`;
}

function buildChannelPanelRowKey(channelCode, periodKey, row) {
  return `${String(channelCode || "").trim()}-${String(periodKey || "").trim()}-${row?.rank}-${String(row?.style || "").trim()}`;
}

function buildStyleSummaryFallback(row) {
  const qty = Number(row?.qty || 0);
  const inventoryQty = Number(row?.inventory_qty || 0);
  return {
    style: String(row?.style || "").trim(),
    category: String(row?.category || "").trim(),
    story_pack: String(row?.story_pack || "").trim(),
    gmv: Number(row?.gmv || 0),
    qty,
    inventory_qty: inventoryQty,
    discount_rate: row?.discount_rate ?? null,
    sell_through: inventoryQty > 0 ? qty / inventoryQty : 0,
    turnover_month: row?.turnover_month ?? null,
    sku_count: null,
    top_sku: String(row?.top_sku || "").trim(),
    top_sku_gmv_share: null,
    top_sku_qty_share: null,
  };
}

export default function ChannelDashboardPage() {
  const { auth } = useAuth();
  const [loading, setLoading] = useState(false);
  const [salesDates, setSalesDates] = useState([]);
  const [appliedRange, setAppliedRange] = useState([]);
  const [draftRange, setDraftRange] = useState([]);
  const [appliedComparisonRange, setAppliedComparisonRange] = useState([]);
  const [draftComparisonRange, setDraftComparisonRange] = useState([]);
  const [availableChannels, setAvailableChannels] = useState([]);
  const [selectedChannels, setSelectedChannels] = useState([]);
  const [draftChannels, setDraftChannels] = useState([]);
  const [panels, setPanels] = useState([]);
  const [styleDrilldowns, setStyleDrilldowns] = useState({});
  const [expandedRowKeysByTable, setExpandedRowKeysByTable] = useState({});
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [draftMajorCategory, setDraftMajorCategory] = useState("");
  const [draftCategory, setDraftCategory] = useState("");
  const [appliedCategoryFilter, setAppliedCategoryFilter] = useState({ majorCategory: "", category: "" });
  const tableRefs = useRef(new Map());
  const syncingScrollRef = useRef(false);
  const styleDrilldownsRef = useRef({});
  const styleDrilldownRequestRef = useRef(new Map());

  useEffect(() => {
    const defaultChannels = Array.isArray(auth?.defaultChannels) && auth.defaultChannels.length > 0 ? auth.defaultChannels : [];
    if (defaultChannels.length > 0) setDraftChannels(defaultChannels);
    http.get("/api/dashboard/filter-options", { params: { _t: Date.now() } })
      .then((resp) => setCategoryOptions(Array.isArray(resp.data?.categories) ? resp.data.categories : []))
      .catch(() => {});
    void loadBoard([], defaultChannels.length > 0 ? defaultChannels : [], [], { majorCategory: "", category: "" });
  }, []);

  useEffect(() => {
    styleDrilldownsRef.current = styleDrilldowns;
  }, [styleDrilldowns]);

  useEffect(() => {
    const bodies = Array.from(tableRefs.current.values())
      .map((node) => node?.querySelector?.(".ant-table-content, .ant-table-body"))
      .filter(Boolean);

    const listeners = bodies.map((body) => {
      const onScroll = () => {
        if (syncingScrollRef.current) {
          return;
        }
        syncingScrollRef.current = true;
        const scrollLeft = body.scrollLeft;
        bodies.forEach((other) => {
          if (other !== body) {
            other.scrollLeft = scrollLeft;
          }
        });
        syncingScrollRef.current = false;
      };
      body.addEventListener("scroll", onScroll, { passive: true });
      return { body, onScroll };
    });

    return () => {
      listeners.forEach(({ body, onScroll }) => body.removeEventListener("scroll", onScroll));
    };
  }, [panels]);

  const loadBoard = async (nextRange, nextChannels, nextComparisonRange = [], catFilter = appliedCategoryFilter) => {
    const dateFrom = nextRange?.[0]?.format?.("YYYY-MM-DD") || "";
    const dateTo = nextRange?.[1]?.format?.("YYYY-MM-DD") || dateFrom;
    const comparisonDateFrom = nextComparisonRange?.[0]?.format?.("YYYY-MM-DD") || "";
    const comparisonDateTo = nextComparisonRange?.[1]?.format?.("YYYY-MM-DD") || comparisonDateFrom;
    const channelText = Array.isArray(nextChannels) && nextChannels.length ? nextChannels.join(",") : "";

    setLoading(true);
    try {
      const params = {
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        comparison_date_from: comparisonDateFrom || undefined,
        comparison_date_to: comparisonDateTo || undefined,
        channels: channelText || undefined,
        _t: Date.now(),
      };
      if (catFilter.majorCategory) params.major_category = catFilter.majorCategory;
      if (catFilter.category) params.category = catFilter.category;
      const resp = await http.get("/api/channel-dashboard", { params });

      const payload = resp.data || {};
      const payloadDates = Array.isArray(payload.sales_dates)
        ? payload.sales_dates
        : Array.isArray(payload.anchor_dates)
          ? payload.anchor_dates
          : [];
      const payloadRange =
        payload.date_from && payload.date_to
          ? [dayjs(String(payload.date_from), "YYYY-MM-DD"), dayjs(String(payload.date_to), "YYYY-MM-DD")]
          : [];
      const payloadComparisonRange =
        payload.comparison_date_from && payload.comparison_date_to
          ? [
              dayjs(String(payload.comparison_date_from), "YYYY-MM-DD"),
              dayjs(String(payload.comparison_date_to), "YYYY-MM-DD"),
            ]
          : [];
      const payloadSelectedChannels = Array.isArray(payload.selected_channels) ? payload.selected_channels : [];

      setSalesDates(payloadDates);
      setAppliedRange(payloadRange);
      setDraftRange(payloadRange);
      setAppliedComparisonRange(payloadComparisonRange);
      setDraftComparisonRange(payloadComparisonRange);
      setAvailableChannels(Array.isArray(payload.available_channels) ? payload.available_channels : []);
      setSelectedChannels(payloadSelectedChannels);
      setDraftChannels(payloadSelectedChannels);
      setPanels(Array.isArray(payload.channels) ? payload.channels : []);
      setStyleDrilldowns({});
      styleDrilldownsRef.current = {};
      setExpandedRowKeysByTable({});
      styleDrilldownRequestRef.current = new Map();
    } catch (err) {
      message.error(err?.response?.data?.message || err.message || "读取渠道看板失败");
    } finally {
      setLoading(false);
    }
  };

  const bindTableRef = (code, node) => {
    if (!node) {
      tableRefs.current.delete(code);
      return;
    }
    tableRefs.current.set(code, node);
  };

  const scrollAllTables = (mode) => {
    const bodies = Array.from(tableRefs.current.values())
      .map((node) => node?.querySelector?.(".ant-table-content, .ant-table-body"))
      .filter(Boolean);
    if (!bodies.length) {
      return;
    }
    syncingScrollRef.current = true;
    bodies.forEach((body) => {
      if (mode === "start") {
        body.scrollLeft = 0;
        return;
      }
      body.scrollLeft += Number(mode || 0);
    });
    syncingScrollRef.current = false;
  };

  const getPeriodRangeParams = (periodKey) => {
    const range = periodKey === "comparison" ? appliedComparisonRange : appliedRange;
    const dateFrom = range?.[0]?.format?.("YYYY-MM-DD") || "";
    const dateTo = range?.[1]?.format?.("YYYY-MM-DD") || dateFrom;
    return { dateFrom, dateTo };
  };

  const ensureStyleDrilldown = async (channelCode, periodKey, row) => {
    const safeChannelCode = String(channelCode || "").trim();
    const safePeriodKey = String(periodKey || "").trim();
    const safeStyle = String(row?.style || "").trim();
    const { dateFrom, dateTo } = getPeriodRangeParams(safePeriodKey);
    if (!safeChannelCode || !safePeriodKey || !safeStyle || !dateFrom || !dateTo) {
      return;
    }

    const cacheKey = buildStyleDrilldownCacheKey(safeChannelCode, safePeriodKey, safeStyle);
    const existing = styleDrilldownsRef.current[cacheKey];
    if (existing?.loaded || existing?.loading || styleDrilldownRequestRef.current.has(cacheKey)) {
      return;
    }

    const requestToken = {};
    styleDrilldownRequestRef.current.set(cacheKey, requestToken);
    setStyleDrilldowns((prev) => ({
      ...prev,
      [cacheKey]: {
        loading: true,
        loaded: false,
        error: "",
        meta: null,
        style_summary: buildStyleSummaryFallback(row),
        items: [],
      },
    }));

    try {
      const resp = await http.get("/api/channel-dashboard/drilldown", {
        params: {
          date_from: dateFrom,
          date_to: dateTo,
          channel: safeChannelCode,
          style: safeStyle,
          _t: Date.now(),
        },
      });
      if (styleDrilldownRequestRef.current.get(cacheKey) !== requestToken) {
        return;
      }
      const payload = resp.data || {};
      setStyleDrilldowns((prev) => ({
        ...prev,
        [cacheKey]: {
          loading: false,
          loaded: true,
          error: "",
          meta: payload.meta || null,
          style_summary: payload.style_summary || buildStyleSummaryFallback(row),
          items: Array.isArray(payload.items) ? payload.items : [],
        },
      }));
    } catch (err) {
      if (styleDrilldownRequestRef.current.get(cacheKey) !== requestToken) {
        return;
      }
      setStyleDrilldowns((prev) => ({
        ...prev,
        [cacheKey]: {
          ...(prev[cacheKey] || {}),
          loading: false,
          loaded: false,
          error: err?.response?.data?.message || err.message || "读取货号明细失败",
          style_summary: prev[cacheKey]?.style_summary || buildStyleSummaryFallback(row),
          items: [],
        },
      }));
      message.error(err?.response?.data?.message || err.message || "读取货号明细失败");
    } finally {
      if (styleDrilldownRequestRef.current.get(cacheKey) === requestToken) {
        styleDrilldownRequestRef.current.delete(cacheKey);
      }
    }
  };

  const toggleStyleDrilldown = (channelCode, periodKey, row) => {
    const safeChannelCode = String(channelCode || "").trim();
    const safePeriodKey = String(periodKey || "").trim();
    const safeStyle = String(row?.style || "").trim();
    if (!safeChannelCode || !safePeriodKey || !safeStyle) {
      return;
    }

    const tableKey = buildStyleDrilldownTableKey(safeChannelCode, safePeriodKey);
    const rowKey = buildChannelPanelRowKey(safeChannelCode, safePeriodKey, row);
    const currentKeys = Array.isArray(expandedRowKeysByTable[tableKey]) ? expandedRowKeysByTable[tableKey] : [];
    const isExpanded = currentKeys.includes(rowKey);
    setExpandedRowKeysByTable((prev) => {
      const prevKeys = Array.isArray(prev[tableKey]) ? prev[tableKey] : [];
      const nextKeys = prevKeys.includes(rowKey)
        ? prevKeys.filter((key) => key !== rowKey)
        : [...prevKeys, rowKey];
      return {
        ...prev,
        [tableKey]: nextKeys,
      };
    });

    if (!isExpanded) {
      void ensureStyleDrilldown(safeChannelCode, safePeriodKey, row);
    }
  };

  const disabledDate = (value) => {
    if (!value || !salesDates.length) {
      return false;
    }
    return !salesDates.includes(value.format("YYYY-MM-DD"));
  };

  const channelOptions = useMemo(
    () =>
      availableChannels.map((item) => ({
        label: item.label,
        value: item.code,
      })),
    [availableChannels]
  );

  const channelLabelMap = useMemo(
    () => new Map(availableChannels.map((item) => [item.code, item.label])),
    [availableChannels]
  );

  const appliedRangeText = toRangeText(appliedRange);
  const draftRangeText = toRangeText(draftRange);
  const appliedComparisonRangeText = toOptionalRangeText(appliedComparisonRange);
  const draftComparisonRangeText = toOptionalRangeText(draftComparisonRange);
  const appliedChannelText = selectedChannels.length
    ? selectedChannels.map((code) => channelLabelMap.get(code) || code).join(" / ")
    : "未选择渠道";

  const skuDetailColumns = useMemo(
    () => [
      {
        title: "货号",
        dataIndex: "sku",
        key: "sku",
        width: 128,
        render: (value) => <SkuPreview sku={value} text={formatTextOrDash(value)} placement="top" />,
      },
      {
        title: "品名",
        dataIndex: "product_name",
        key: "product_name",
        width: 168,
        ellipsis: true,
        render: (value) => formatTextOrDash(value),
      },
      {
        title: "吊牌价",
        dataIndex: "tag_price",
        key: "tag_price",
        width: 70,
        align: TABLE_NUMBER_ALIGN,
        render: (value) => formatDecimal(value, 0),
      },
      {
        title: "出库金额(万)",
        dataIndex: "gmv",
        key: "gmv",
        width: 86,
        align: TABLE_NUMBER_ALIGN,
        render: (value) => formatWan(value),
      },
      {
        title: "出库金额占比",
        dataIndex: "gmv_share_pct",
        key: "gmv_share_pct",
        width: 76,
        align: TABLE_NUMBER_ALIGN,
        render: (value) => formatPercent(value, 1),
      },
      {
        title: "销量",
        dataIndex: "qty",
        key: "qty",
        width: 64,
        align: TABLE_NUMBER_ALIGN,
        render: (value) => formatInteger(value),
      },
      {
        title: "销量占比",
        dataIndex: "qty_share_pct",
        key: "qty_share_pct",
        width: 76,
        align: TABLE_NUMBER_ALIGN,
        render: (value) => formatPercent(value, 1),
      },
      {
        title: "库存",
        dataIndex: "inventory_qty",
        key: "inventory_qty",
        width: 64,
        align: TABLE_NUMBER_ALIGN,
        render: (value) => formatInteger(value),
      },
      {
        title: "折扣率",
        dataIndex: "discount_rate",
        key: "discount_rate",
        width: 66,
        align: TABLE_NUMBER_ALIGN,
        render: (value) => formatPercentInteger(value),
      },
      {
        title: "售罄率",
        dataIndex: "sell_through",
        key: "sell_through",
        width: 66,
        align: TABLE_NUMBER_ALIGN,
        render: (value) => formatPercentInteger(value),
      },
    ],
    []
  );

  const renderStyleAction = (value, row, channelCode, periodKey) => {
    const style = String(value || "").trim();
    if (!style) {
      return formatTextOrDash(value);
    }
    const tableKey = buildStyleDrilldownTableKey(channelCode, periodKey);
    const rowKey = buildChannelPanelRowKey(channelCode, periodKey, row);
    const isExpanded = (expandedRowKeysByTable[tableKey] || []).includes(rowKey);
    const cacheKey = buildStyleDrilldownCacheKey(channelCode, periodKey, style);
    const drilldown = styleDrilldowns[cacheKey];

    return (
      <Button
        type="link"
        size="small"
        className="channel-style-link"
        loading={Boolean(drilldown?.loading)}
        onClick={(event) => {
          event.stopPropagation();
          toggleStyleDrilldown(channelCode, periodKey, row);
        }}
      >
        <span className="channel-style-value">{formatTextOrDash(style)}</span>
        <Text type="secondary" className="channel-style-expand-hint">
          {isExpanded ? "收起" : "展开"}
        </Text>
      </Button>
    );
  };

  const buildColumns = (channelCode, periodKey) => [
    {
      title: "排名",
      dataIndex: "rank",
      key: "rank",
      width: 48,
      align: TABLE_NUMBER_ALIGN,
    },
    {
      title: "款号",
      dataIndex: "style",
      key: "style",
      width: 132,
      align: TABLE_NUMBER_ALIGN,
      className: "channel-style-cell",
      render: (value, row) => renderStyleAction(value, row, channelCode, periodKey),
    },
    {
      title: "中类",
      dataIndex: "category",
      key: "category",
      width: 72,
      align: TABLE_NUMBER_ALIGN,
      ellipsis: true,
      render: (value) => formatTextOrDash(value),
    },
    {
      title: "故事包",
      dataIndex: "story_pack",
      key: "story_pack",
      width: 76,
      align: TABLE_NUMBER_ALIGN,
      ellipsis: true,
      render: (value) => formatTextOrDash(value),
    },
    {
      title: "出库金额(万)",
      dataIndex: "gmv",
      key: "gmv",
      width: 84,
      align: TABLE_NUMBER_ALIGN,
      render: (value) => formatWan(value),
    },
    {
      title: "销量",
      dataIndex: "qty",
      key: "qty",
      width: 62,
      align: TABLE_NUMBER_ALIGN,
      render: (value) => formatInteger(value),
    },
    {
      title: "库存",
      dataIndex: "inventory_qty",
      key: "inventory_qty",
      width: 66,
      align: TABLE_NUMBER_ALIGN,
      render: (value) => formatInteger(value),
    },
    {
      title: "折扣率",
      dataIndex: "discount_rate",
      key: "discount_rate",
      width: 64,
      align: TABLE_NUMBER_ALIGN,
      render: (value) => formatPercentInteger(value),
    },
    {
      title: "周转月",
      dataIndex: "turnover_month",
      key: "turnover_month",
      width: 68,
      align: TABLE_NUMBER_ALIGN,
      render: (value) => formatInteger(value),
    },
    {
      title: "主销 SKU",
      dataIndex: "top_sku",
      key: "top_sku",
      width: 92,
      align: TABLE_NUMBER_ALIGN,
      render: (_, row) => <SkuPreview sku={row.top_sku} text={formatTextOrDash(row.top_sku)} placement="top" />,
    },
  ];

  const renderStyleExpandedRow = (channelCode, periodKey, row) => {
    const style = String(row?.style || "").trim();
    const cacheKey = buildStyleDrilldownCacheKey(channelCode, periodKey, style);
    const drilldown = styleDrilldowns[cacheKey] || {};
    const summary = drilldown.style_summary || buildStyleSummaryFallback(row);

    return (
      <div className="channel-style-drilldown">
        <Space wrap size={6} className="channel-style-drilldown-summary">
          <Tag color="blue">款号：{formatTextOrDash(summary.style || row?.style)}</Tag>
          <Tag color="cyan">中类：{formatTextOrDash(summary.category || row?.category)}</Tag>
          <Tag color="geekblue">货号数：{summary.sku_count === null ? "-" : formatInteger(summary.sku_count)}</Tag>
          <Tag color="purple">出库金额(万)：{formatWan(summary.gmv)}</Tag>
          <Tag color="magenta">销量：{formatInteger(summary.qty)}</Tag>
          <Tag color="orange">库存：{formatInteger(summary.inventory_qty)}</Tag>
          <Tag color="gold">主销货号：{formatTextOrDash(summary.top_sku || row?.top_sku)}</Tag>
          <Tag color="lime">主销出库金额占比：{formatPercent(summary.top_sku_gmv_share, 1)}</Tag>
        </Space>
        {drilldown.error ? (
          <Text type="danger" className="channel-style-drilldown-error">
            {drilldown.error}
          </Text>
        ) : null}
        <Table
          rowKey={(item) => `${item.style || style}-${item.sku || ""}`}
          className="app-compact-table channel-style-drilldown-table"
          columns={skuDetailColumns}
          dataSource={Array.isArray(drilldown.items) ? drilldown.items : []}
          loading={Boolean(drilldown.loading)}
          pagination={false}
          size="small"
          tableLayout="fixed"
          scroll={{ x: 864 }}
          locale={{ emptyText: <Empty description="该款暂无货号明细" /> }}
        />
      </div>
    );
  };

  const buildExpandableConfig = (channelCode, periodKey) => {
    const tableKey = buildStyleDrilldownTableKey(channelCode, periodKey);
    return {
      expandedRowKeys: expandedRowKeysByTable[tableKey] || [],
      expandedRowRender: (row) => renderStyleExpandedRow(channelCode, periodKey, row),
      rowExpandable: (row) => Boolean(String(row?.style || "").trim()),
      showExpandColumn: false,
    };
  };

  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <Card className="hero-card">
        <Title level={3} style={{ marginBottom: 8 }}>
          渠道店铺看板
        </Title>
        <Text type="secondary">支持任意销售区间筛选，并可额外选择一个同期区间查看对应渠道的同期 Top20，用来和当前区间对比。</Text>
      </Card>

      <Card bordered={false} size="small" className="dense-card">
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Space wrap size={10} className="compact-toolbar">
            <RangePicker
              allowClear={false}
              value={draftRange.length === 2 ? draftRange : null}
              disabledDate={disabledDate}
              onChange={(values) => {
                setDraftRange(normalizePickerRange(values));
              }}
            />
            <RangePicker
              value={draftComparisonRange.length === 2 ? draftComparisonRange : null}
              disabledDate={disabledDate}
              placeholder={["同期开始", "同期结束"]}
              onChange={(values) => {
                setDraftComparisonRange(normalizePickerRange(values));
              }}
            />
            <Select
              mode="multiple"
              style={{ minWidth: 360 }}
              placeholder="选择渠道"
              maxCount={MAX_CHANNELS}
              value={draftChannels}
              options={channelOptions}
              onChange={(values) => {
                setDraftChannels(Array.isArray(values) ? values.slice(0, MAX_CHANNELS) : []);
              }}
            />
            <Select style={{ minWidth: 120 }} placeholder="全部大类" value={draftMajorCategory || undefined} allowClear onChange={(v) => { setDraftMajorCategory(v || ""); setDraftCategory(""); }} options={[...new Set(categoryOptions.map((c) => c.major_category))].map((mc) => ({ label: mc, value: mc }))} />
            {draftMajorCategory ? <Select style={{ minWidth: 120 }} placeholder="全部中类" value={draftCategory || undefined} allowClear onChange={(v) => setDraftCategory(v || "")} options={categoryOptions.filter((c) => c.major_category === draftMajorCategory).map((c) => ({ label: c.category, value: c.category }))} /> : null}
            <Button
              type="primary"
              loading={loading}
              disabled={draftRange.length !== 2 || loading}
              onClick={() => {
                const nextCatFilter = { majorCategory: draftMajorCategory, category: draftCategory };
                setAppliedCategoryFilter(nextCatFilter);
                void loadBoard(draftRange, draftChannels, draftComparisonRange, nextCatFilter);
              }}
            >
              应用筛选
            </Button>
            <Button disabled={loading} onClick={() => {
              setDraftMajorCategory("");
              setDraftCategory("");
              setAppliedCategoryFilter({ majorCategory: "", category: "" });
              const defaultChannels = Array.isArray(auth?.defaultChannels) && auth.defaultChannels.length > 0 ? auth.defaultChannels : [];
              setDraftChannels(defaultChannels);
              void loadBoard([], defaultChannels, [], { majorCategory: "", category: "" });
            }}>
              重置
            </Button>
            <Tag color="blue">最多 4 个渠道</Tag>
          </Space>

          <Space wrap size={8}>
            <Tag color="geekblue">当前区间：{appliedRangeText}</Tag>
            <Tag color="cyan">当前渠道：{appliedChannelText}</Tag>
            <Tag color="purple">同期区间：{appliedComparisonRangeText}</Tag>
            <Tag color="magenta">草稿区间：{draftRangeText}</Tag>
            <Tag color="orange">同期草稿：{draftComparisonRangeText}</Tag>
          </Space>

          <Space wrap size={8}>
            <Button onClick={() => scrollAllTables(-220)}>全部左移</Button>
            <Button onClick={() => scrollAllTables(220)}>全部右移</Button>
            <Button onClick={() => scrollAllTables("start")}>回到首列</Button>
            <Text type="secondary">任一面板横向滚动时，其他渠道表格会同步滚动。</Text>
          </Space>
        </Space>
      </Card>

      {loading ? (
        <Card bordered={false}>
          <div className="settings-loading">
            <Spin tip="正在加载渠道看板..." />
          </div>
        </Card>
      ) : panels.length ? (
        <div className="channel-dashboard-grid">
          {panels.map((panel) => {
            const hasComparison = panel.comparison_summary !== null && panel.comparison_summary !== undefined;
            const tabItems = [
              {
                key: "current",
                label: "当前 Top20",
                children: (
                  <Table
                    rowKey={(row) => buildChannelPanelRowKey(panel.code, "current", row)}
                    className="app-compact-table channel-panel-table"
                    columns={buildColumns(panel.code, "current")}
                    dataSource={Array.isArray(panel.items) ? panel.items : []}
                    expandable={buildExpandableConfig(panel.code, "current")}
                    pagination={false}
                    size="small"
                    tableLayout="fixed"
                    scroll={{ x: 740 }}
                    locale={{ emptyText: <Empty description="当前区间暂无该渠道 Top20 数据" /> }}
                  />
                ),
              },
            ];

            if (hasComparison) {
              tabItems.push({
                key: "comparison",
                label: "同期 Top20",
                children: (
                  <Table
                    rowKey={(row) => buildChannelPanelRowKey(panel.code, "comparison", row)}
                    className="app-compact-table channel-panel-table"
                    columns={buildColumns(panel.code, "comparison")}
                    dataSource={Array.isArray(panel.comparison_items) ? panel.comparison_items : []}
                    expandable={buildExpandableConfig(panel.code, "comparison")}
                    pagination={false}
                    size="small"
                    tableLayout="fixed"
                    scroll={{ x: 740 }}
                    locale={{ emptyText: <Empty description="同期区间暂无该渠道 Top20 数据" /> }}
                  />
                ),
              });
            }

            return (
              <Card
                key={panel.code}
                className="channel-panel-card"
                title={panel.label}
                extra={
                  <Space size={8}>
                    <Tag color="blue">{panel.summary?.row_count || 0} 个款号</Tag>
                  </Space>
                }
              >
                <div className="channel-panel-summary">
                  <div className="channel-panel-summary-item">
                    <Statistic title="当前 出库金额(万)" value={formatWan(panel.summary?.gmv || 0)} />
                  </div>
                  <div className="channel-panel-summary-item">
                    <Statistic title="当前销量" value={formatInteger(panel.summary?.qty || 0)} />
                  </div>
                  <div className="channel-panel-summary-item">
                    <Statistic title="Top20 金额占比" value={formatPercentInteger(panel.summary?.top20_gmv_share || 0)} />
                  </div>
                  <div className="channel-panel-summary-item">
                    <Statistic title="区间末日折扣率" value={formatPercentInteger(panel.summary?.anchor_discount_rate || 0)} />
                  </div>
                </div>

                {hasComparison ? (
                  <Space wrap size={8} className="channel-panel-compare-strip">
                    <Tag color="geekblue">同期区间：{appliedComparisonRangeText}</Tag>
                    {renderComparisonTag("出库金额同比", panel.summary?.gmv, panel.comparison_summary?.gmv)}
                    {renderComparisonTag("销量同比", panel.summary?.qty, panel.comparison_summary?.qty)}
                    {renderComparisonTag("Top20占比同比", panel.summary?.top20_gmv_share, panel.comparison_summary?.top20_gmv_share)}
                    {renderComparisonTag("折扣同比", panel.summary?.anchor_discount_rate, panel.comparison_summary?.anchor_discount_rate)}
                  </Space>
                ) : null}

                <div ref={(node) => bindTableRef(panel.code, node)} className="channel-panel-tabs">
                  <Tabs size="small" items={tabItems} />
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card bordered={false}>
          <Empty description="当前筛选条件下暂无渠道看板数据" />
        </Card>
      )}
    </Space>
  );
}
