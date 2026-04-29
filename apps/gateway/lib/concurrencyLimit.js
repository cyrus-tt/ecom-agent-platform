"use strict";

/**
 * Semaphore · F-PERF-40C 步骤 S6
 *
 * 用途：限制重操作的并发数，避免拖垮普通看板访问。
 *   - Excel 导出（4 个 endpoint 共用 Semaphore(2)）
 *   - AI 报告生成（Semaphore(1)）
 *
 * 与 rebuild-weekly 的 RUNNING_JOB_BY_TYPE 锁不同：
 *   - RUNNING_JOB_BY_TYPE = 0/1 互斥锁，且基于异步 job
 *   - Semaphore = N 并发上限 + 立即返 busy（不等队列）
 *
 * 行为：
 *   - tryAcquire() → 若有许可立即拿走、返 release 函数；否则返 null（让 handler 决定 429）
 *   - acquire() → 阻塞等待直到拿到许可（本期不用，留 API 给未来队列场景）
 *
 * 注意：本实现是**无队列**的"立即拒绝"语义。理由：
 *   - 用户给的需求"超限时返回明确状态"暗示"不让排队拖太久"
 *   - 排队会让请求堆在内存里，反而扩大爆炸半径
 *   - 用户会在前端看 429 后自己重试，比看 30 秒转圈好
 */

class Semaphore {
  /**
   * @param {number} permits - 最大并发数
   * @param {string} name    - 用于日志 / 监控
   */
  constructor(permits, name = "semaphore") {
    if (!Number.isInteger(permits) || permits <= 0) {
      throw new Error(`Semaphore(${name}) requires permits > 0 integer, got ${permits}`);
    }
    this.maxPermits = permits;
    this.available = permits;
    this.name = name;
    /** 已发出但未释放的许可数 = maxPermits - available */
    this._inUse = 0;
  }

  /**
   * 尝试拿一个许可。
   * @returns {(() => void) | null} 拿到 → release 函数；拿不到 → null
   */
  tryAcquire() {
    if (this.available <= 0) {
      return null;
    }
    this.available -= 1;
    this._inUse += 1;
    let released = false;
    return () => {
      if (released) return; // 防重复释放
      released = true;
      this.available += 1;
      this._inUse -= 1;
      if (this.available > this.maxPermits) {
        // 不应该发生；防御性日志
        // eslint-disable-next-line no-console
        console.warn(`[concurrencyLimit][${this.name}] released too many; clamping`);
        this.available = this.maxPermits;
      }
    };
  }

  /** 当前正在使用的许可数（= 正在跑的请求数） */
  get inUse() {
    return this._inUse;
  }

  stats() {
    return {
      name: this.name,
      maxPermits: this.maxPermits,
      inUse: this._inUse,
      available: this.available,
    };
  }
}

/**
 * Express 中间件工厂：基于 Semaphore + tryAcquire 实现"立即拒绝"。
 * 用法：
 *   const exportLimit = new Semaphore(2, "excel-export");
 *   app.get("/api/foo/export.xlsx", limitConcurrency(exportLimit), handler);
 *
 * 失败时返 429 + JSON：
 *   {
 *     ok: false,
 *     busy: true,
 *     in_use: <number>,
 *     max: <number>,
 *     message: "系统正在处理大量同类请求，请稍后再试"
 *   }
 */
function limitConcurrency(semaphore, options = {}) {
  const message = options.message || "系统正在处理大量同类请求，请稍后再试";
  return function limitConcurrencyMiddleware(req, res, next) {
    const release = semaphore.tryAcquire();
    if (!release) {
      return res.status(429).json({
        ok: false,
        busy: true,
        in_use: semaphore.inUse,
        max: semaphore.maxPermits,
        message,
      });
    }
    // res 完成（finish/close/error）时统一释放
    let released = false;
    const releaseOnce = () => {
      if (released) return;
      released = true;
      release();
    };
    res.on("finish", releaseOnce);
    res.on("close", releaseOnce);
    res.on("error", releaseOnce);
    next();
  };
}

module.exports = { Semaphore, limitConcurrency };
