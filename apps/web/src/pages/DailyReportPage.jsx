// V3 migrated to api/hooks/components — see docs/plans/2026-04-25-v3-frontend-api-layer-plan.md
import { DownloadOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Input, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { reportsApi } from "../api";
import { DataTable, DateRangePicker, HeroCard, PageHeader, SkuPreview } from "../components";
import { useApi, useDateRange, useTableQuery } from "../hooks";
import { formatInteger, formatSmartNumber, TABLE_NUMBER_ALIGN } from "../utils/numbers";

const { Search } = Input;
const { Text } = Typography;

const DEFAULT_PAGE_SIZE = 50;
const LEFT_ALIGNED_COLUMN_INDEXES = new Set([1, 2, 3, 4, 5, 7, 8, 9]);
const LAST_FIXED_LEFT_COLUMN_INDEX = 2;

const COLUMN_WIDTHS = [96, 84, 124, 82, 88, 148, 76, 72, 68, 84];

function formatCellValue(value, index) {
  if (value === null || value === undefined || value === "") return "-";
  if (index === 2) return <SkuPreview sku={String(value)} text={String(value)} imageBasePath="/api/arrival/image" />;
  return typeof value === "number" ? formatSmartNumber(value) : String(value);
}

function resolveDailyColumnWidth(index) {
  if (index < COLUMN_WIDTHS.length) return COLUMN_WIDTHS[index];
  return index <= 54 ? 82 : 86;
}

function resolveDailySurfaceClass(index) {
  if (index >= 10 && index <= 31) return "daily-surface-inventory";
  if (index >= 32 && index <= 54) return "daily-surface-sales";
  return "";
}

function createLeaf(index, columnHeaders) {
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
    onHeaderCell: () => ({ className: surfaceClassName }),
    render: (_, row) => formatCellValue(row.values[index], index),
  };
}

function buildDailyColumns(meta) {
  const columnHeaders = Array.isArray(meta?.column_headers) ? meta.column_headers : [];
  const groupHeaders = Array.isArray(meta?.group_headers) ? meta.group_headers : [];
  if (!columnHeaders.length) return [];
  if (!groupHeaders.length) return columnHeaders.map((_, idx) => createLeaf(idx, columnHeaders));

  const sections = [];
  let currentTitle = "";
  let currentChildren = [];
  let currentStartIndex = 0;
  columnHeaders.forEach((_, index) => {
    const title = String(groupHeaders[index] || "").trim();
    if (title) {
      if (currentChildren.length) sections.push({ title: currentTitle, children: currentChildren, startIndex: currentStartIndex });
      currentTitle = title;
      currentChildren = [];
      currentStartIndex = index;
    }
    currentChildren.push(createLeaf(index, columnHeaders));
  });
  if (currentChildren.length) sections.push({ title: currentTitle, children: currentChildren, startIndex: currentStartIndex });

  const splitSections = [];
  for (const section of sections) {
    const fixedChildren = section.children.filter((_, i) => section.startIndex + i <= LAST_FIXED_LEFT_COLUMN_INDEX);
    const scrollChildren = section.children.slice(fixedChildren.length);
    if (fixedChildren.length && scrollChildren.length) {
      splitSections.push({ ...section, children: fixedChildren });
      splitSections.push({ ...section, children: scrollChildren, startIndex: section.startIndex + fixedChildren.length });
    } else {
      splitSections.push(section);
    }
  }

  return splitSections.flatMap((section, idx) => {
    if (!section.title) return section.children;
    const hasFixed = section.startIndex <= LAST_FIXED_LEFT_COLUMN_INDEX;
    const surfaceClassName = resolveDailySurfaceClass(section.startIndex);
    return [{ key: `group_${idx}`, title: section.title, className: surfaceClassName, fixed: hasFixed ? "left" : undefined,
      onHeaderCell: () => ({ className: surfaceClassName }), children: section.children }];
  });
}

export default function DailyReportPage() {
  const dateRange = useDateRange({
    fetchDates: reportsApi.getDailyReportDates,
    pickDates: (data) => data?.sales_dates,
    pickDefault: (data) => data?.default_sales_date,
    defaultSpanDays: 1,
  });
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");

  const [dateFrom, dateTo] = dateRange.appliedTexts;
  const hasRange = Boolean(dateFrom && dateTo);

  // 分页 + 搜索：靠 useTableQuery 统一管
  const tableQuery = useTableQuery(
    ({ page, pageSize, dateFrom: f, dateTo: t, keyword: kw }) =>
      reportsApi.getDailyReportRows({ dateFrom: f, dateTo: t, page, pageSize, keyword: kw }),
    {
      initialPageSize: DEFAULT_PAGE_SIZE,
      initialFilters: { dateFrom, dateTo, keyword: "" },
      enabled: hasRange,
      fallbackMessage: "读取日报数据失败",
    }
  );

  // 首次拉到默认日期后，自动同步给 tableQuery（否则首次不会触发 rows 请求）
  useEffect(() => {
    if (!hasRange) return;
    if (tableQuery.filters.dateFrom === dateFrom && tableQuery.filters.dateTo === dateTo) return;
    tableQuery.setFilters({ dateFrom, dateTo, keyword });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, hasRange]);

  // meta 单独拉（受同样 dateFrom/dateTo 触发）
  const { data: meta } = useApi(
    () => reportsApi.getDailyReportMeta({ dateFrom, dateTo }),
    [dateFrom, dateTo],
    { enabled: hasRange, fallbackMessage: "读取日报元信息失败" }
  );

  const columns = useMemo(() => buildDailyColumns(meta), [meta]);
  const dataSource = useMemo(
    () =>
      tableQuery.dataSource.map((values, idx) => ({
        key: `${tableQuery.page}_${idx}`,
        values,
      })),
    [tableQuery.dataSource, tableQuery.page]
  );

  const handleRangeChange = (nextRange) => {
    if (!nextRange.length) return;
    dateRange.apply(nextRange);
    const f = nextRange[0].format("YYYY-MM-DD");
    const t = nextRange[1].format("YYYY-MM-DD");
    tableQuery.setFilters({ dateFrom: f, dateTo: t, keyword });
  };

  const handleSearch = (value) => {
    const next = String(value || "").trim();
    setKeyword(next);
    tableQuery.setFilters({ dateFrom, dateTo, keyword: next });
  };

  const handleReset = () => {
    const next = dateRange.reset();
    setKeyword("");
    setKeywordInput("");
    if (next.length) {
      tableQuery.setFilters({
        dateFrom: next[0].format("YYYY-MM-DD"),
        dateTo: next[1].format("YYYY-MM-DD"),
        keyword: "",
      });
    }
  };

  const handleExport = () => {
    if (!hasRange) return;
    window.open(reportsApi.dailyReportExportUrl({ dateFrom, dateTo }), "_blank");
  };

  const rangeText = hasRange ? `${dateFrom} ~ ${dateTo}` : "-";
  const gap = meta?.gap_summary || {};

  return (
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      <HeroCard>
        <PageHeader title="日报主表" description="按销售日期范围筛选主表数据，支持搜索、分页、导出和货号图片预览。" />
      </HeroCard>

      <Card bordered={false} size="small" className="dense-card">
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Space wrap size={10} className="compact-toolbar">
            <DateRangePicker range={dateRange} onChange={handleRangeChange} />
            <Search allowClear placeholder="搜索货号 / 款号 / 品名" value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)} onSearch={handleSearch}
              enterButton={<SearchOutlined />} style={{ width: 280 }} />
            <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
            <Button type="primary" icon={<DownloadOutlined />} onClick={handleExport}>导出 XLSB</Button>
          </Space>

          <div className="daily-meta-strip">
            <Tag color="blue">销售日期 {rangeText}</Tag>
            <Tag color="geekblue">行数 {formatInteger(meta?.row_count || tableQuery.pagination.total)}</Tag>
            <Tag color="green">库存快照 {meta?.inventory_date || "-"}</Tag>
            <Tag color="purple">生成时间 {meta?.generated_at || "-"}</Tag>
          </div>

          <Alert type="info" showIcon message="映射缺口摘要"
            description={`门店渠道 ${gap.missing_store_channel || 0} / 分配池渠道 ${gap.missing_pool_channel || 0} / 分配池比率 ${gap.missing_pool_ratio || 0} / 库存未知渠道 ${gap.unknown_inventory_channel || 0} / 销售未知渠道 ${gap.unknown_sales_channel || 0}`} />
        </Space>
      </Card>

      <Card bordered={false} size="small" bodyStyle={{ padding: 0 }}>
        <DataTable rowKey="key" className="app-compact-table daily-report-table"
          columns={columns} dataSource={dataSource} loading={tableQuery.loading}
          pagination={tableQuery.pagination} onChange={tableQuery.onChange}
          tableLayout="fixed" scroll={{ x: "max-content", y: 620 }} />
      </Card>
    </Space>
  );
}
