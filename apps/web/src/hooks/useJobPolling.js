import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 替代 `while(true) sleep(2s) get jobs/:id` 的轮询循环。
 *
 * @param {{
 *   jobApi: (id: string) => Promise<{ job: any }>,
 *   intervalMs?: number,
 *   onProgress?: (job: any) => void,
 *   maxAttempts?: number,
 * }} options
 */
export function useJobPolling(options) {
  const { jobApi, intervalMs = 2000, onProgress, maxAttempts = 600 } = options;
  const [status, setStatus] = useState("idle"); // 'idle' | 'running' | 'done' | 'error'
  const [job, setJob] = useState(null);
  const stopRef = useRef(false);

  const stop = useCallback(() => {
    stopRef.current = true;
  }, []);

  const run = useCallback(
    async (jobId) => {
      if (!jobId) return null;
      stopRef.current = false;
      setStatus("running");
      setJob(null);

      let attempts = 0;
      while (!stopRef.current && attempts < maxAttempts) {
        attempts += 1;
        try {
          const resp = await jobApi(jobId);
          const next = resp?.job || resp || {};
          setJob(next);
          onProgress?.(next);
          const state = String(next?.status || next?.state || "").toLowerCase();
          if (state === "done" || state === "completed" || state === "success") {
            setStatus("done");
            return next;
          }
          if (state === "error" || state === "failed") {
            setStatus("error");
            return next;
          }
        } catch (err) {
          setStatus("error");
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      if (!stopRef.current) setStatus("error");
      return job;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [intervalMs, jobApi, maxAttempts, onProgress]
  );

  useEffect(
    () => () => {
      stopRef.current = true;
    },
    []
  );

  return { run, stop, status, job };
}

export default useJobPolling;
