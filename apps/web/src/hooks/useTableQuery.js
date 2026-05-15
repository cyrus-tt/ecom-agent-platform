import { useCallback, useState } from "react";
import { useApi } from "./useApi";

/**
 * 整合分页 + 搜索 + 排序 + refetch 的 hook。
 *
 * fetcher 必须返回 `{ items: T[], total: number }`，AntD Table 的 dataSource/pagination 直接接。
 *
 * @template T
 * @param {(args: { page: number, pageSize: number } & Record<string, any>) => Promise<{ items: T[], total: number }>} fetcher
 * @param {{
 *   initialPageSize?: number,
 *   initialFilters?: Record<string, any>,
 *   pageSizeOptions?: string[],
 *   fallbackMessage?: string,
 *   enabled?: boolean,
 * }} [options]
 */
export function useTableQuery(fetcher, options = {}) {
  const {
    initialPageSize = 50,
    initialFilters = {},
    pageSizeOptions = ["50", "100", "200"],
    fallbackMessage = "读取数据失败",
    enabled = true,
  } = options;

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [filters, setFilters] = useState(initialFilters);

  // 把 filters 序列化进 deps（避免引用变化引起多余请求）
  const filtersKey = JSON.stringify(filters);

  const { data, loading, refetch, setData } = useApi(
    () => fetcher({ page, pageSize, ...filters }),
    [page, pageSize, filtersKey, enabled],
    { enabled, fallbackMessage }
  );

  const onChange = useCallback(
    (next) => {
      setPage(Number(next?.current || 1));
      setPageSize(Number(next?.pageSize || pageSize));
    },
    [pageSize]
  );

  const updateFilters = useCallback((patch, { resetPage = true } = {}) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    if (resetPage) setPage(1);
  }, []);

  const resetPage = useCallback(() => setPage(1), []);

  const pagination = {
    current: page,
    pageSize,
    total: Number(data?.total || 0),
    showSizeChanger: true,
    pageSizeOptions,
    showTotal: (n) => `共 ${n} 行`,
  };

  return {
    dataSource: Array.isArray(data?.items) ? data.items : [],
    pagination,
    loading,
    refetch,
    onChange,
    filters,
    setFilters: updateFilters,
    resetPage,
    setData,
    page,
    pageSize,
  };
}

export default useTableQuery;
