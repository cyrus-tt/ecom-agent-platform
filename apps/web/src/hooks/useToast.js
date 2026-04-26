import { App as AntdApp } from "antd";
import { errorMessage } from "../api/http";

/**
 * AntD 5 推荐的 message 用法：必须在 `<AntdApp>` 组件树内才能拿到 `message` 实例。
 *
 * - main.jsx 已经在所有路径（含 DispatchConfirm 公开页旁路）顶层包了 `<AntdApp>`
 * - 拦截器 (api/http.js) 不在 React 树内 → 不能用本 hook，仍走 window.location.href
 *
 * @returns {{
 *   success: (text: string) => void,
 *   info: (text: string) => void,
 *   warn: (text: string) => void,
 *   error: (errOrText: unknown, fallback?: string) => void,
 *   raw: any,
 * }}
 */
export function useToast() {
  const { message } = AntdApp.useApp();
  return {
    success: (text) => message.success(text),
    info: (text) => message.info(text),
    warn: (text) => message.warning(text),
    error: (errOrText, fallback) =>
      message.error(typeof errOrText === "string" ? errOrText : errorMessage(errOrText, fallback)),
    raw: message,
  };
}

export default useToast;
