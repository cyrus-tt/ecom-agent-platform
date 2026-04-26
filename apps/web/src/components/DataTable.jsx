import { Table } from "antd";

/**
 * AntD `<Table>` 的样板包装：
 *  - 默认 size=small + 紧凑表头类
 *  - 可一行接 useTableQuery 返回值（`query.dataSource / pagination / loading / onChange`）
 *  - 同时也兼容手动传 dataSource/pagination/loading（二选一）
 *
 * @param {{
 *   query?: ReturnType<typeof import("../hooks/useTableQuery").useTableQuery>,
 *   columns: any[],
 *   rowKey?: string | ((row: any) => string),
 *   dataSource?: any[],
 *   pagination?: any,
 *   loading?: boolean,
 *   onChange?: (next: any) => void,
 *   className?: string,
 *   scroll?: any,
 *   size?: "small"|"middle"|"large",
 *   bordered?: boolean,
 *   tableLayout?: string,
 *   emptyText?: string,
 * }} props
 */
export default function DataTable({
  query,
  columns,
  rowKey,
  dataSource,
  pagination,
  loading,
  onChange,
  className = "app-compact-table",
  scroll,
  size = "small",
  bordered,
  tableLayout,
  emptyText = "暂无数据",
  ...rest
}) {
  const finalDataSource = Array.isArray(dataSource) ? dataSource : query?.dataSource || [];
  const finalPagination = pagination !== undefined ? pagination : query?.pagination;
  const finalLoading = loading !== undefined ? loading : !!query?.loading;
  const finalOnChange = onChange || query?.onChange;

  return (
    <Table
      rowKey={rowKey}
      columns={columns}
      dataSource={finalDataSource}
      pagination={finalPagination}
      loading={finalLoading}
      onChange={finalOnChange}
      size={size}
      className={className}
      scroll={scroll}
      bordered={bordered}
      tableLayout={tableLayout}
      locale={{ emptyText: finalLoading ? "正在加载..." : emptyText }}
      {...rest}
    />
  );
}
