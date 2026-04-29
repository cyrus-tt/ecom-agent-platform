import { ArrowDownOutlined, ArrowRightOutlined, ArrowUpOutlined } from "@ant-design/icons";
import { Card, Empty, Space, Statistic, Table, Tag, Typography } from "antd";
import { useMemo } from "react";
import { formatPercent, formatSmartNumber, formatTextOrDash, TABLE_NUMBER_ALIGN } from "../utils/numbers";

const { Text } = Typography;

const CATEGORY_MAJOR_PRIORITY = new Map([
  ["鞋类", 0],
  ["服装", 1],
]);

function renderChangeNode(value) {
  if (value === null || value === undefined) {
    return <Tag color="default">N/A</Tag>;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return <Tag color="default">N/A</Tag>;
  }
  const icon = num > 0 ? <ArrowUpOutlined /> : num < 0 ? <ArrowDownOutlined /> : <ArrowRightOutlined />;
  const color = num > 0 ? "#d4380d" : num < 0 ? "#389e0d" : "#8c8c8c";
  return <span style={{ color }}>{icon} {(num * 100).toFixed(2)}%</span>;
}

function normalizeMajorCategory(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.includes("鞋")) {
    return "鞋类";
  }
  if (text.includes("服")) {
    return "服装";
  }
  return text;
}

function buildCategoryPivotRows(channel) {
  const majorSummaryRows = Array.isArray(channel?.sections?.major_category) ? channel.sections.major_category : [];
  const categoryRows = Array.isArray(channel?.sections?.category) ? channel.sections.category : [];
  const summaryByMajor = new Map();
  const detailsByMajor = new Map();

  majorSummaryRows.forEach((row) => {
    const major = normalizeMajorCategory(row?.label || row?.major_category);
    if (!major) {
      return;
    }
    summaryByMajor.set(major, {
      ...row,
      key: `summary__${major}`,
      major_category: major,
      label: "汇总",
      row_type: "summary",
    });
  });

  categoryRows.forEach((row, index) => {
    const major = normalizeMajorCategory(row?.major_category);
    if (!major) {
      return;
    }
    if (!detailsByMajor.has(major)) {
      detailsByMajor.set(major, []);
    }
    detailsByMajor.get(major).push({
      ...row,
      key: row?.key || `detail__${major}__${index}`,
      major_category: major,
      row_type: "detail",
    });
  });

  const majorOrder = Array.from(new Set([...summaryByMajor.keys(), ...detailsByMajor.keys()])).sort((left, right) => {
    const leftPriority = CATEGORY_MAJOR_PRIORITY.has(left) ? CATEGORY_MAJOR_PRIORITY.get(left) : 99;
    const rightPriority = CATEGORY_MAJOR_PRIORITY.has(right) ? CATEGORY_MAJOR_PRIORITY.get(right) : 99;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    const leftShare = Number(summaryByMajor.get(left)?.gmv_share_pct || 0);
    const rightShare = Number(summaryByMajor.get(right)?.gmv_share_pct || 0);
    if (Math.abs(rightShare - leftShare) > 1e-9) {
      return rightShare - leftShare;
    }
    return String(left || "").localeCompare(String(right || ""), "zh-CN");
  });

  const result = [];
  majorOrder.forEach((major) => {
    const summary = summaryByMajor.get(major);
    if (summary) {
      result.push(summary);
    }

    const details = Array.from(detailsByMajor.get(major) || []).sort((left, right) => {
      const shareDiff = Number(right?.gmv_share_pct || 0) - Number(left?.gmv_share_pct || 0);
      if (Math.abs(shareDiff) > 1e-9) {
        return shareDiff;
      }
      const qtyDiff = Number(right?.qty_share_pct || 0) - Number(left?.qty_share_pct || 0);
      if (Math.abs(qtyDiff) > 1e-9) {
        return qtyDiff;
      }
      return String(left?.label || "").localeCompare(String(right?.label || ""), "zh-CN");
    });
    result.push(...details);
  });

  return result;
}

function buildColumns(sectionKey) {
  const columns = [];
  if (sectionKey === "category") {
    columns.push({
      title: "大类",
      dataIndex: "major_category",
      key: "major_category",
      width: 116,
      ellipsis: true,
      render: (value, row) =>
        row?.row_type === "detail" ? "" : <span className="dashboard-compare-group-label">{formatTextOrDash(value)}</span>,
    });
  }

  columns.push({
    title: sectionKey === "season" ? "产品季" : sectionKey === "major_category" ? "大类" : "中类",
    dataIndex: "label",
    key: "label",
    width: sectionKey === "season" ? 112 : 124,
    ellipsis: true,
    render: (value, row) => {
      if (sectionKey !== "category") {
        return formatTextOrDash(value);
      }
      if (row?.row_type === "summary") {
        return <span className="dashboard-compare-group-label">汇总</span>;
      }
      return <span className="dashboard-compare-detail-label">{formatTextOrDash(value)}</span>;
    },
  });

  columns.push(
    {
      title: "金额占比",
      dataIndex: "gmv_share_pct",
      key: "gmv_share_pct",
      width: 92,
      align: TABLE_NUMBER_ALIGN,
      render: (value) => formatPercent(value, 2),
    },
    {
      title: "销量占比",
      dataIndex: "qty_share_pct",
      key: "qty_share_pct",
      width: 92,
      align: TABLE_NUMBER_ALIGN,
      render: (value) => formatPercent(value, 2),
    },
    {
      title: "件单",
      dataIndex: "piece_price",
      key: "piece_price",
      width: 84,
      align: TABLE_NUMBER_ALIGN,
      render: (value) => formatSmartNumber(value, 2),
    },
    {
      title: "金额变化",
      dataIndex: "gmv_week_pct",
      key: "gmv_week_pct",
      width: 108,
      align: TABLE_NUMBER_ALIGN,
      render: (value) => renderChangeNode(value),
    },
    {
      title: "销量变化",
      dataIndex: "qty_week_pct",
      key: "qty_week_pct",
      width: 108,
      align: TABLE_NUMBER_ALIGN,
      render: (value) => renderChangeNode(value),
    },
    {
      title: "件单变化",
      dataIndex: "piece_price_week_pct",
      key: "piece_price_week_pct",
      width: 108,
      align: TABLE_NUMBER_ALIGN,
      render: (value) => renderChangeNode(value),
    }
  );

  return columns;
}

export default function ChannelCompareSection({ title, sectionKey, channels, loading = false, showSummary = false }) {
  const columns = useMemo(() => buildColumns(sectionKey), [sectionKey]);

  return (
    <Card title={title} bordered={false} size="small" className="dense-card">
      {channels.length ? (
        <div className="dashboard-compare-grid">
          {channels.map((channel) => {
            const rows =
              sectionKey === "category"
                ? buildCategoryPivotRows(channel)
                : Array.isArray(channel?.sections?.[sectionKey])
                  ? channel.sections[sectionKey]
                  : [];

            return (
              <Card
                key={`${sectionKey}_${channel.code}`}
                title={channel.label}
                bordered={false}
                size="small"
                className="dashboard-compare-panel"
              >
                {showSummary ? (
                  <div className="dashboard-compare-summary">
                    <div className="dashboard-compare-summary-item">
                      <Statistic title="出库金额" value={formatSmartNumber(channel.summary?.gmv, 2)} />
                    </div>
                    <div className="dashboard-compare-summary-item">
                      <Statistic title="销量" value={formatSmartNumber(channel.summary?.qty, 2)} />
                    </div>
                    <div className="dashboard-compare-summary-item">
                      <Statistic title="件单" value={formatSmartNumber(channel.summary?.piece_price, 2)} />
                    </div>
                  </div>
                ) : null}

                <Space wrap size={[8, 8]} className="dashboard-compare-tag-strip">
                  <Tag color="blue">金额变化 {renderChangeNode(channel.summary?.gmv_week_pct)}</Tag>
                  <Tag color="cyan">销量变化 {renderChangeNode(channel.summary?.qty_week_pct)}</Tag>
                  <Tag color="purple">件单变化 {renderChangeNode(channel.summary?.piece_price_week_pct)}</Tag>
                </Space>

                {rows.length ? (
                  <Table
                    rowKey={(row) => row.key}
                    className="app-compact-table"
                    columns={columns}
                    dataSource={rows}
                    pagination={false}
                    loading={loading}
                    size="small"
                    tableLayout="fixed"
                    rowClassName={(row) => (row?.row_type === "summary" ? "dashboard-compare-group-row" : "")}
                    scroll={{ x: sectionKey === "category" ? 780 : 660, y: 360 }}
                  />
                ) : (
                  <Empty description="当前渠道暂无明细" />
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="settings-loading">
          {loading ? <Text type="secondary">正在加载对比数据...</Text> : <Empty description="当前筛选条件下暂无渠道对比数据" />}
        </div>
      )}
    </Card>
  );
}
