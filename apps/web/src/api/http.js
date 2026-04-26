import axios from "axios";

/**
 * 全站 axios 实例：
 * - 同源 cookie 鉴权
 * - 401 拦截：跳 /login?next=...，避免每个 page 自己处理
 *
 * 约定（V3 起）：
 * 1. fetcher 调用方一律走 `api/<module>.js`，不要直接 import http。
 * 2. 防缓存参数 `_t: Date.now()` 由 fetcher 自动加，page 不再手抖。
 * 3. 失败处理交给 `useApi` 或 page 自己（拦截器只负责 401 跳转，不弹 toast；
 *    因为拦截器不在 React 树内，不能用 AntD App.useApp() 的 message）。
 */
const http = axios.create({
  baseURL: "/",
  withCredentials: true,
  timeout: 95000,
  headers: {
    Accept: "application/json",
  },
});

http.interceptors.response.use(
  (resp) => resp,
  (error) => {
    if (error?.response?.status === 401 && typeof window !== "undefined") {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.href = `/login?next=${encodeURIComponent(next)}`;
      return Promise.reject(error);
    }
    return Promise.reject(error);
  }
);

/**
 * 统一错误信息提取。fetcher 抛出 Error 后，调用方一律用本工具拼 toast 文案。
 *
 * @param {unknown} err   抛出的错误对象（一般是 axios error）
 * @param {string} [fallback] 兜底文案（一般写"读取 XX 失败"）
 * @returns {string}
 */
export function errorMessage(err, fallback = "请求失败") {
  if (!err) return fallback;
  return (
    err?.response?.data?.message ||
    err?.message ||
    fallback
  );
}

export default http;
