import { App as AntdApp } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../api/http";

/**
 * 通用请求 hook：替代 `useState(loading) + useState(data) + useState(error) + useEffect` 的 4 行组合。
 *
 * 设计要点：
 *  - 内置 reqIdRef 解决竞态（旧版 4 个 page 自己 hand-roll 的同样代码）
 *  - 默认弹 `message.error(errorMessage(err, fallback))`
 *  - 503 / 自定义错误流程传 `silentError: true` + `onError`
 *  - `setData` 暴露出去：mutation 后乐观更新
 *
 * @template T
 * @param {() => Promise<T>} fetcher
 *   fetcher 函数（一般是 api/* 的某个函数 + 已绑定参数）
 * @param {any[]} deps
 *   依赖（变化时自动 refetch）
 * @param {{
 *   enabled?: boolean,
 *   onSuccess?: (data: T) => void,
 *   onError?: (err: Error) => void,
 *   fallbackMessage?: string,
 *   silentError?: boolean,
 *   immediate?: boolean,
 * }} [options]
 */
export function useApi(fetcher, deps = [], options = {}) {
  const {
    enabled = true,
    onSuccess,
    onError,
    fallbackMessage = "请求失败",
    silentError = false,
    immediate = true,
  } = options;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const reqIdRef = useRef(0);
  const { message } = AntdApp.useApp();

  // 用 ref 包 fetcher，避免每次渲染产生不同身份污染 deps
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refetch = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      if (reqIdRef.current !== reqId) return undefined;
      setData(result);
      onSuccess?.(result);
      return result;
    } catch (err) {
      if (reqIdRef.current !== reqId) return undefined;
      setError(err);
      if (onError) {
        onError(err);
      } else if (!silentError) {
        message.error(errorMessage(err, fallbackMessage));
      }
      return undefined;
    } finally {
      if (reqIdRef.current === reqId) setLoading(false);
    }
    // deps 由调用方决定，这里禁用 lint
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!enabled) return;
    if (!immediate) return;
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);

  return { data, loading, error, refetch, setData };
}

export default useApi;
