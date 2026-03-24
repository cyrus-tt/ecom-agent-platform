import { DownloadOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Alert, Button, Card, DatePicker, Input, Space, Table, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";
import http from "../api/http";
import SkuPreview from "../components/SkuPreview";
import { formatInteger, formatSmartNumber, TABLE_NUMBER_ALIGN } from "../utils/numbers";

const { RangePicker } = DatePicker;
const { Search } = Input;
const { Title, Text } = Typography;

const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = ["50", "100", "200"];
const LEFT_ALIGNED_COLUMN_INDEXES = new Set([1, 2, 3, 4, 5, 7, 8, 9]);
const LAST_FIXED_LEFT_COLUMN_INDEX = 2;

function toDateValue(text) {
  const value = dayjs(String(text || ""), "YYYY-MM-DD");
  return value.isValid() ? value : null;
}

function normalizePickerRange(values) {
  if (!Array.isArray(values) || values.length !== 2 || !values[0] || !values[1]) {
    return [];
  }
  return values;
}

function buildRangeFromTexts(dateFromText, dateToText) {
  const start = toDateValue(dateFromText);
  const end = toDateValue(dateToText);
  return start && end ? [start, end] : [];
}

function formatCellValue(value, index) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (index === 2) {
    return <SkuPreview sku={String(value)} text={String(value)} imageBasePath="/api/arrival/image" />;
  }
  if (typeof value !== "number") {
    return String(value);
  }
  return formatSmartNumber(value);
}

function resolveDailyColumnWidth(index) {
  if (index === 0) {
    return 96;
  }
  if (index === 1) {
    return 84;
  }
  if (index === 2) {
    return 124;
  }
  if (index === 3) {
    return 82;
  }
  if (index === 4) {
    return 88;
  }
  if (index === 5) {
    return 148;
  }
  if (index === 6) {
    return 76;
  }
  if (index === 7) {
    return 72;
  }
  if (index === 8) {
    return 68;
  }
  if (index === 9) {
    return 84;
  }
  if (index <= 54) {
    return 82;
  }
  return 86;
}

function resolveDailySurfaceClass(index) {
  if (index >= 10 && index <= 31) {
    return "daily-surface-inventory";
  }
  if (index >= 32 && index <= 54) {
    return "daily-surface-sales";
  }
  return "";
}

function buildDailyColumns(meta) {
  const columnHeaders = Array.isArray(meta?.column_headers) ? meta.column_headers : [];
  const groupHeaders = Array.isArray(meta?.group_headers) ? meta.group_headers : [];
  if (!columnHeaders.length) {
    return [];
  }

  const createLeaf = (index) => {
    const surfaceClassName = resolveDailySurfaceClass(index);
    const isLeftAligned = LEFT_ALIGNED_COLUMN_INDEXES.has(index);
    const isFixedLeft = index <= LAST_FIXED_LEFT_COLUMN_INDEX;
    return {
      key: `col_${index}`,
      title: columnHeaders[index] || `列${index + 1}`,
      width: resolveDailyColumnWidth(index),
      align: isLeftAligned ? "left" : TABLE_NUMBER_ALIGN,
      fixed: isFixedLeft ? "left" : undefined,
      className: [isLeftAligned ? "cell-text-left" : "", surfaceClassName].filter(Boolean).join(" "),
      ellipsis: true,
      onHeaderCell: () => ({
        className: surfaceClassName,
      }),
      render: (_, row) => formatCellValue(row.values[index], index),
    };
  };

  if (!groupHeaders.length) {
    return columnHeaders.map((_, index) => createLeaf(index));
  }

  const sections = [];
  let currentTitle = "";
  let currentChildren = [];
  let currentStartIndex = 0;

  columnHeaders.forEach((_, index) => {
    const title = String(groupHeaders[index] || "").trim();
    if (title) {
      if (currentChildren.length) {
        sections.push({ title: currentTitle, children: currentChildren, startIndex: currentStartIndex });
      }
      currentTitle = title;
      currentChildren = [];
      currentStartIndex = index;
    }
    currentChildren.push(createLeaf(index));
  });

  if (currentChildren.length) {
    sections.push({ title: currentTitle, children: currentChildren, startIndex: currentStartIndex });
  }

  return sections.flatMap((section, index) => {
    if (!section.title) {
      return section.children;
    }
    const surfaceClassName = resolveDailySurfaceClass(section.startIndex);
    return [
      {
        key: `group_${index}`,
        title: section.title,
        className: surfaceClassName,
        onHeaderCell: () => ({
          className: surfaceClassName,
        }),
        children: section.children,
      },
    ];
  });
}

export default function DailyReportPage() {
  const [salesDates, setSalesDates] = useState([]);
  const [appliedRange, setAppliedRange] = useState([]);
  const [draftRange, setDraftRange] = useState([]);
  const [keyword, setKeyword] = useState("");
  const [meta, setMeta] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const loadRequestRef = useRef(0);

  useEffect(() => {
    void initPage();
  }, []);

  const columns = useMemo(() => buildDailyColumns(meta), [meta]);
  const dataSource = useMemo(
    () =>
      rows.map((values, index) => ({
        key: `${page}_${index}`,
        values,
      })),
    [page, rows]
  );

  const initPage = async () => {
    try {
      const resp = await http.get("/api/report-daily/dates", { params: { _t: Date.now() } });
      const list = Array.isArray(resp.data?.sales_dates) ? resp.data.sales_dates : [];
      const latest = String(resp.data?.default_sales_date || list[0] || "");
      setSalesDates(list);
      const defaultRange = latest ? [toDateValue(latest), toDateValue(latest)].filter(Boolean) : [];
      setDraftRange(defaultRange);
      await loadRangeData({
        nextRange: defaultRange,
        nextPage: 1,
        nextPageSize: DEFAULT_PAGE_SIZE,
        nextKeyword: "",
      });
    } catch (err) {
      message.error(err?.response?.data?.message || err.message || "读取日报主表失败");
    }
  };

  const loadRangeData = async ({ nextRange, nextPage, nextPageSize, nextKeyword }) => {
    const start = nextRange?.[0]?.format?.("YYYY-MM-DD") || "";
    const end = nextRange?.[1]?.format?.("YYYY-MM-DD") || start;
    if (!start || !end) {
      return;
    }

    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setDraftRange(nextRange);
    setLoading(true);
    try {
      const [metaResp, rowsResp] = await Promise.all([
        http.get("/api/report-daily/meta", {
          params: {
            dateFrom: start,
            dateTo: end,
            _t: Date.now(),
          },
        }),
        http.get("/api/report-daily/rows", {
          params: {
            dateFrom: start,
            dateTo: end,
            page: nextPage,
            pageSize: nextPageSize,
            keyword: nextKeyword || undefined,
            _t: Date.now(),
          },
        }),
      ]);

      if (loadRequestRef.current !== requestId) {
        return;
      }

      const resolvedRange = buildRangeFromTexts(metaResp.data?.date_from || start, metaResp.data?.date_to || end);
      const nextAppliedRange = resolvedRange.length === 2 ? resolvedRange : nextRange;
      setAppliedRange(nextAppliedRange);
      setDraftRange(nextAppliedRange);
      setPage(nextPage);
      setPageSize(nextPageSize);
      setKeyword(nextKeyword);
      setMeta(metaResp.data || null);
      setRows(Array.isArray(rowsResp.data?.items) ? rowsResp.data.items : []);
      setTotal(Number(rowsResp.data?.total || 0));
    } catch (err) {
      if (loadRequestRef.current !== requestId) {
        return;
      }
      setDraftRange(appliedRange);
      message.error(err?.response?.data?.message || err.message || "读取日报数据失败");
    } finally {
      if (loadRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  };

  const handleRangeChange = async (values) => {
    const nextRange = normalizePickerRange(values);
    setDraftRange(nextRange);
    if (!nextRange.length) {
      return;
    }
    await loadRangeData({
      nextRange,
      nextPage: 1,
      nextPageSize: pageSize,
      nextKeyword: keyword,
    });
  };

  const handleSearch = async (value) => {
    await loadRangeData({
      nextRange: appliedRange,
      nextPage: 1,
      nextPageSize: pageSize,
      nextKeyword: String(value || "").trim(),
    });
  };

  const handleReset = async () => {
    const latest = String(salesDates[0] || "");
    const defaultRange = latest ? [toDateValue(latest), toDateValue(latest)].filter(Boolean) : [];
    setDraftRange(defaultRange);
    await loadRangeData({
      nextRange: defaultRange,
      nextPage: 1,
      nextPageSize: DEFAULT_PAGE_SIZE,
      nextKeyword: "",
    });
  };

  const handleExport = () => {
    const start = appliedRange?.[0]?.format?.("YYYY-MM-DD") || "";
    const end = appliedRange?.[1]?.format?.("YYYY-MM-DD") || start;
    if (!start || !end) {
      return;
    }
    window.open(`/api/report-daily/export.xlsb?dateFrom=${encodeURIComponent(start)}&dateTo=${encodeURIComponent(end)}`, "_blank");
  };

  const disabledDate = (value) => {
    if (!value || !salesDates.length) {
      return false;
    }
    return !salesDates.includes(value.format("YYYY-MM-DD"));
  };

  const pagination = {
    current: page,
    pageSize,
    total,
    showSizeChanger: true,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    onChange: async (nextPage, nextPageSize) => {
      await loadRangeData({
        nextRange: appliedRange,
        nextPage,
        nextPageSize,
        nextKeyword: keyword,
      });
    },
    showTotal: (value) => `共 ${value} 行`,
  };

  const rangeText =
    appliedRange?.[0] && appliedRange?.[1]
      ? `${appliedRange[0].format("YYYY-MM-DD")} ~ ${appliedRange[1].format("YYYY-MM-DD")}`
      : "-";
  const gap = meta?.gap_summary || {};

  return (
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      <Card className="hero-card" size="small">
        <Title level={3} style={{ marginBottom: 8 }}>
          日报主表
        </Title>
        <Text type="secondary">按销售日期范围筛选主表数据，支持搜索、分页、导出和货号图片预览。</Text>
      </Card>

      <Card bordered={false} size="small" className="dense-card">
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Space wrap size={10} className="compact-toolbar">
            <RangePicker
              value={draftRange.length === 2 ? draftRange : null}
              allowClear={false}
              disabledDate={disabledDate}
              onChange={handleRangeChange}
            />
            <Search
              allowClear
              placeholder="搜索货号 / 款号 / 品名"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onSearch={handleSearch}
              enterButton={<SearchOutlined />}
              style={{ width: 280 }}
            />
            <Button icon={<ReloadOutlined />} onClick={handleReset}>
              重置
            </Button>
            <Button type="primary" icon={<DownloadOutlined />} onClick={handleExport}>
              导出 XLSB
            </Button>
          </Space>

          <div className="daily-meta-strip">
            <Tag color="blue">销售日期 {rangeText}</Tag>
            <Tag color="geekblue">行数 {formatInteger(meta?.row_count || total)}</Tag>
            <Tag color="green">库存快照 {meta?.inventory_date || "-"}</Tag>
            <Tag color="purple">生成时间 {meta?.generated_at || "-"}</Tag>
          </div>

          <Alert
            type="info"
            showIcon
            message="映射缺口摘要"
            description={`门店渠道 ${gap.missing_store_channel || 0} / 分配池渠道 ${gap.missing_pool_channel || 0} / 分配池比率 ${gap.missing_pool_ratio || 0} / 库存未知渠道 ${gap.unknown_inventory_channel || 0} / 销售未知渠道 ${gap.unknown_sales_channel || 0}`}
          />
        </Space>
      </Card>

      <Card bordered={false} size="small" bodyStyle={{ padding: 0 }}>
        <Table
          rowKey="key"
          className="app-compact-table daily-report-table"
          columns={columns}
          dataSource={dataSource}
          loading={loading}
          pagination={pagination}
          size="small"
          tableLayout="fixed"
          scroll={{ x: "max-content", y: 620 }}
          locale={{
            emptyText: loading ? "正在加载..." : "暂无数据",
          }}
        />
      </Card>
    </Space>
  );
}
