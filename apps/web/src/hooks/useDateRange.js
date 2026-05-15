import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "./useApi";

function toDateValue(text) {
  if (!text) return null;
  const value = dayjs(String(text), "YYYY-MM-DD");
  return value.isValid() ? value : null;
}

function buildRange(startText, endText) {
  const start = toDateValue(startText);
  const end = toDateValue(endText || startText);
  return start && end ? [start, end] : [];
}

/**
 * 封装"销售日期窗口"模式：
 *  - 拉一次可选日期清单 + 默认日期
 *  - 维护 draft（用户在 Picker 上正在改的）/ applied（已生效的）
 *  - 提供 disabledDate
 *  - 提供 apply / reset
 *
 * @param {{
 *   fetchDates: () => Promise<any>,
 *   pickDates?: (data: any) => string[],
 *   pickDefault?: (data: any) => string | undefined,
 *   defaultSpanDays?: number,
 *   enabled?: boolean,
 * }} options
 */
export function useDateRange(options) {
  const {
    fetchDates,
    pickDates = (data) => data?.sales_dates || [],
    pickDefault = (data) => data?.default_sales_date,
    defaultSpanDays = 1,
    enabled = true,
  } = options;

  const [salesDates, setSalesDates] = useState([]);
  const [appliedRange, setAppliedRange] = useState([]);
  const [draftRange, setDraftRange] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const { loading, refetch } = useApi(
    () => fetchDates(),
    [enabled],
    {
      enabled,
      fallbackMessage: "读取日期清单失败",
      onSuccess: (data) => {
        const list = Array.isArray(pickDates(data)) ? pickDates(data) : [];
        setSalesDates(list);
        const fallback = list[0];
        const latest = String(pickDefault(data) || fallback || "");
        if (!latest) {
          setLoaded(true);
          return;
        }
        const end = toDateValue(latest);
        let start = end;
        if (defaultSpanDays > 1 && end) {
          start = end.subtract(defaultSpanDays - 1, "day");
        }
        const next = start && end ? [start, end] : [];
        setAppliedRange(next);
        setDraftRange(next);
        setLoaded(true);
      },
      onError: () => setLoaded(true),
    }
  );

  const disabledDate = useCallback(
    (value) => {
      if (!value || !salesDates.length) return false;
      return !salesDates.includes(value.format("YYYY-MM-DD"));
    },
    [salesDates]
  );

  const apply = useCallback((nextRange) => {
    setAppliedRange(nextRange);
    setDraftRange(nextRange);
  }, []);

  const reset = useCallback(() => {
    const latest = salesDates[0];
    if (!latest) return [];
    const end = toDateValue(latest);
    let start = end;
    if (defaultSpanDays > 1 && end) {
      start = end.subtract(defaultSpanDays - 1, "day");
    }
    const next = start && end ? [start, end] : [];
    setAppliedRange(next);
    setDraftRange(next);
    return next;
  }, [defaultSpanDays, salesDates]);

  // 当首次 dates 拉到，且调用方需要立即同步触发数据加载，可以监听 loaded
  useEffect(() => {
    // no-op：导出 loaded 让调用方决定何时执行第一次 loadData
  }, [loaded]);

  const appliedTexts = useMemo(() => {
    if (!appliedRange[0] || !appliedRange[1]) return ["", ""];
    return [appliedRange[0].format("YYYY-MM-DD"), appliedRange[1].format("YYYY-MM-DD")];
  }, [appliedRange]);

  const draftTexts = useMemo(() => {
    if (!draftRange[0] || !draftRange[1]) return ["", ""];
    return [draftRange[0].format("YYYY-MM-DD"), draftRange[1].format("YYYY-MM-DD")];
  }, [draftRange]);

  return {
    salesDates,
    appliedRange,
    draftRange,
    appliedTexts,
    draftTexts,
    setDraftRange,
    setAppliedRange,
    apply,
    reset,
    disabledDate,
    loaded,
    loading,
    refetch,
  };
}

export { toDateValue, buildRange };
export default useDateRange;
