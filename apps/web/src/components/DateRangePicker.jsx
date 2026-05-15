import { DatePicker } from "antd";

const { RangePicker } = DatePicker;

/**
 * 受 `useDateRange` 返回值驱动的 RangePicker。
 *
 * 调用方负责处理"用户改完日期后实际触发哪些请求"——本组件只管 UI。
 *
 * @param {{
 *   range: ReturnType<typeof import("../hooks/useDateRange").useDateRange>,
 *   onChange?: (nextRange: any[]) => void,
 *   allowClear?: boolean,
 *   disabled?: boolean,
 *   style?: any,
 *   className?: string,
 *   size?: "small"|"middle"|"large",
 * }} props
 */
export default function DateRangePicker({ range, onChange, allowClear = false, disabled, style, className, size }) {
  const value = range?.draftRange?.length === 2 ? range.draftRange : null;
  return (
    <RangePicker
      value={value}
      allowClear={allowClear}
      disabled={disabled}
      disabledDate={range?.disabledDate}
      onChange={(values) => {
        const nextRange = Array.isArray(values) && values[0] && values[1] ? values : [];
        range?.setDraftRange?.(nextRange);
        onChange?.(nextRange);
      }}
      style={style}
      className={className}
      size={size}
    />
  );
}
