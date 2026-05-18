import { DownloadOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Card, Input, Space, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";
import { reportsApi } from "../api";
import { DataTable, DateRangePicker, HeroCard, PageHeader, SkuPreview } from "../components";
import { useApi, useDateRange, useTableQuery } from "../hooks";
import { formatInteger, formatSmartNumber, TABLE_NUMBER_ALIGN } from "../utils/numbers";

const { Search } = Input;

const DEFAULT_PAGE_SIZE = 50;
const LAST_FIXED_LEFT_COLUMN_INDEX = 2;
const LEFT_ALIGNED_COLUMN_INDEXES = new Set([0, 1, 2, 3, 4, 5, 6, 8, 11, 12]);

const COLUMN_WIDTHS = [96, 84, 124, 82, 88, 156, 72, 78, 96, 76, 76, 120, 112];
const OUTLET_GROUP_RANGES = [
  { start: 0, end: 0 },
  { start: 9, end: 10 },
  { start: 13, end: 13 },
  { start: 14, end: 14 },
  { start: 15, end: 16 },
  { start: 18, end: 26 },
  { start: 27, end: 27 },
  { start: 28, end: 28 },
  { start: 29, end: 29 },
  { start: 31, end: 49 },
  { start: 50, end: 67 },
];

function formatCellValue(value, index) {
  if (value === null || value === undefined || value === "") return "-";
  if (index === 2) return <SkuPreview sku={String(value)} text={String(value)} imageBasePath="/api/arrival/image" />;
  return typeof value === "number" ? formatSmartNumber(value) : String(value);
}

function resolveOutletColumnWidth(index) {
  if (index < COLUMN_WIDTHS.length) return COLUMN_WIDTHS[index];
  if (index >= 50) return 88;
  return 82;
}

function resolveOutletSurfaceClass(index) {
  if (index >= 9 && index <= 12) return "outlet-surface-manual";
  if (index >= 13 && index <= 30) return "outlet-surface-inventory";
  if (index >= 31 && index <= 49) return "outlet-surface-sales";
  if (index >= 50) return "outlet-surface-discount";
  return "";
}

function createLeaf(index, columnHeaders) {
  const surfaceClassName = resolveOutletSurfaceClass(index);
  const isLeftAligned = LEFT_ALIGNED_COLUMN_INDEXES.has(index);
  const isFixedLeft = index <= LAST_FIXED_LEFT_COLUMN_INDEX;
  return {
    key: `col_${index}`,
    title: columnHeaders[index] || `列${index + 1}`,
    width: resolveOutletColumnWidth(index),
    align: isLeftAligned ? "left" : TABLE_NUMBER_ALIGN,
    fixed: isFixedLeft ? "left" : undefined,
    className: [isLeftAligned ? "cell-text-left" : "", surfaceClassName].filter(Boolean).join(" "),
    ellipsis: true,
    onHeaderCell: () => ({ className: surfaceClassName }),
    render: (_, row) => formatCellValue(row.values[index], index),
  };
}

function buildOutletColumns(meta) {
  const columnHeaders = Array.isArray(meta?.column_headers) ? meta.column_headers : [];
  const groupHeaders = Array.isArray(meta?.group_headers) ? meta.group_headers : [];
  if (!columnHeaders.length) return [];

  const rangesByStart = new Map(OUTLET_GROUP_RANGES.map((range) => [range.start, range]));
  const columns = [];
  for (let index = 0; index < columnHeaders.length;) {
    const range = rangesByStart.get(index) || { start: index, end: index, blank: true };
    const end = Math.min(range.end, columnHeaders.length - 1);
    const surfaceClassName = resolveOutletSurfaceClass(index);
    const isFixedGroup = index <= LAST_FIXED_LEFT_COLUMN_INDEX && end <= LAST_FIXED_LEFT_COLUMN_INDEX;
    columns.push({
      key: `group_${index}_${end}`,
      title: range.blank ? "" : String(groupHeaders[index] || "").trim(),
      className: surfaceClassName,
      fixed: isFixedGroup ? "left" : undefined,
      onHeaderCell: () => ({ className: surfaceClassName }),
      children: Array.from({ length: end - index + 1 }, (_, offset) => createLeaf(index + offset, columnHeaders)),
    });
    index = end + 1;
  }
  return columns;
}

export default function OutletAssortmentPage() {
  const dateRange = useDateRange({
    fetchDates: reportsApi.getOutletAssortmentDates,
    pickDates: (data) => data?.sales_dates,
    pickDefaultRange: (data) => [data?.default_date_from, data?.default_date_to],
  });
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");

  const [dateFrom, dateTo] = dateRange.appliedTexts;
  const hasRange = Boolean(dateFrom && dateTo);

  const { data: meta } = useApi(
    () => reportsApi.getOutletAssortmentMeta({ dateFrom, dateTo }),
    [dateFrom, dateTo],
    { enabled: hasRange, fallbackMessage: "读取奥莱货盘元信息失败" }
  );

  const rowsEnabled = hasRange && meta?.date_from === dateFrom && meta?.date_to === dateTo;
  const tableQuery = useTableQuery(
    ({ page, pageSize, dateFrom: f, dateTo: t, keyword: kw }) =>
      reportsApi.getOutletAssortmentRows({ dateFrom: f, dateTo: t, page, pageSize, keyword: kw }),
    {
      initialPageSize: DEFAULT_PAGE_SIZE,
      initialFilters: { dateFrom, dateTo, keyword: "" },
      enabled: rowsEnabled,
      fallbackMessage: "读取奥莱货盘数据失败",
    }
  );

  useEffect(() => {
    if (!hasRange) return;
    if (tableQuery.filters.dateFrom === dateFrom && tableQuery.filters.dateTo === dateTo) return;
    tableQuery.setFilters({ dateFrom, dateTo, keyword });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, hasRange]);

  const columns = useMemo(() => buildOutletColumns(meta), [meta]);
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
    window.open(reportsApi.outletAssortmentExportUrl({ dateFrom, dateTo }), "_blank");
  };

  const rangeText = hasRange ? `${dateFrom} ~ ${dateTo}` : "-";

  return (
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      <HeroCard>
        <PageHeader title="奥莱货盘" description="按销售日期范围查询奥莱货盘明细，支持搜索、分页、导出和货号图片预览。" />
      </HeroCard>

      <Card bordered={false} size="small" className="dense-card">
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Space wrap size={10} className="compact-toolbar">
            <DateRangePicker range={dateRange} onChange={handleRangeChange} />
            <Search
              allowClear
              placeholder="搜索货号 / 款号"
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              onSearch={handleSearch}
              enterButton={<SearchOutlined />}
              style={{ width: 280 }}
            />
            <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
            <Button type="primary" icon={<DownloadOutlined />} onClick={handleExport}>导出 XLSX</Button>
          </Space>

          <div className="daily-meta-strip">
            <Tag color="blue">销售日期 {rangeText}</Tag>
            <Tag color="geekblue">行数 {formatInteger(meta?.row_count || tableQuery.pagination.total)}</Tag>
            <Tag color="green">库存快照 {meta?.inventory_date || "-"}</Tag>
            <Tag color="purple">生成时间 {meta?.generated_at || "-"}</Tag>
          </div>
        </Space>
      </Card>

      <Card bordered={false} size="small" bodyStyle={{ padding: 0 }}>
        <DataTable
          rowKey="key"
          className="app-compact-table outlet-assortment-table"
          columns={columns}
          dataSource={dataSource}
          loading={tableQuery.loading || (hasRange && !meta)}
          pagination={tableQuery.pagination}
          onChange={tableQuery.onChange}
          tableLayout="fixed"
          scroll={{ x: "max-content", y: 620 }}
        />
      </Card>
    </Space>
  );
}
