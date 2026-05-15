import { describe, it, expect, beforeEach, afterEach } from "vitest";

// 单元测试策略：
//   - 每个 case 显式设置 ENABLE_PASSWORD_POLICY 再 require，避免测试之间串环境变量
//   - 用 vi.resetModules 每次重新加载模块，使 isEnabled() 在 require 时生效
//   - validate() 每次调用时都会读 env，所以实际上 resetModules 不是必须，但保留更稳

const MODULE_PATH = "../../lib/passwordPolicy";

function loadPolicy() {
  // eslint-disable-next-line global-require
  return require(MODULE_PATH);
}

describe("passwordPolicy (unit)", () => {
  const originalEnv = process.env.ENABLE_PASSWORD_POLICY;

  beforeEach(() => {
    delete process.env.ENABLE_PASSWORD_POLICY;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ENABLE_PASSWORD_POLICY;
    else process.env.ENABLE_PASSWORD_POLICY = originalEnv;
  });

  describe("isEnabled()", () => {
    it("默认启用", () => {
      delete process.env.ENABLE_PASSWORD_POLICY;
      expect(loadPolicy().isEnabled()).toBe(true);
    });

    it("显式 true 启用", () => {
      process.env.ENABLE_PASSWORD_POLICY = "true";
      expect(loadPolicy().isEnabled()).toBe(true);
    });

    it("显式 false 关闭", () => {
      process.env.ENABLE_PASSWORD_POLICY = "false";
      expect(loadPolicy().isEnabled()).toBe(false);
    });

    it('"0" 关闭', () => {
      process.env.ENABLE_PASSWORD_POLICY = "0";
      expect(loadPolicy().isEnabled()).toBe(false);
    });

    it('空串视为默认（启用）', () => {
      process.env.ENABLE_PASSWORD_POLICY = "";
      expect(loadPolicy().isEnabled()).toBe(true);
    });
  });

  describe("validate() 启用模式", () => {
    beforeEach(() => {
      process.env.ENABLE_PASSWORD_POLICY = "true";
    });

    it("合法强密码通过", () => {
      const r = loadPolicy().validate("Abcdef12");
      expect(r.ok).toBe(true);
      expect(r.reasons).toEqual([]);
    });

    it("另一个合法密码（带符号）通过", () => {
      const r = loadPolicy().validate("MyP@ssw0rdX");
      expect(r.ok).toBe(true);
    });

    it("太短返回 ok=false + 长度原因", () => {
      const r = loadPolicy().validate("Ab1");
      expect(r.ok).toBe(false);
      expect(r.reasons.some((m) => m.includes("至少 8 位"))).toBe(true);
    });

    it("缺小写", () => {
      const r = loadPolicy().validate("ABCDEF12");
      expect(r.ok).toBe(false);
      expect(r.reasons.some((m) => m.includes("小写"))).toBe(true);
    });

    it("缺大写", () => {
      const r = loadPolicy().validate("abcdef12");
      expect(r.ok).toBe(false);
      expect(r.reasons.some((m) => m.includes("大写"))).toBe(true);
    });

    it("缺数字", () => {
      const r = loadPolicy().validate("AbcdefGh");
      expect(r.ok).toBe(false);
      expect(r.reasons.some((m) => m.includes("数字"))).toBe(true);
    });

    it("命中黑名单 'password'（大小写不敏感）", () => {
      const r = loadPolicy().validate("Password");
      expect(r.ok).toBe(false);
      // Password 本身也缺数字，会同时报两条
      expect(r.reasons.some((m) => m.includes("弱口令"))).toBe(true);
    });

    it("命中黑名单 'admin123'", () => {
      const r = loadPolicy().validate("admin123");
      expect(r.ok).toBe(false);
      expect(r.reasons.some((m) => m.includes("弱口令"))).toBe(true);
    });

    it("命中黑名单 '12345678'", () => {
      const r = loadPolicy().validate("12345678");
      expect(r.ok).toBe(false);
      expect(r.reasons.some((m) => m.includes("弱口令"))).toBe(true);
    });

    it("超长（> 128 位）被拒", () => {
      const r = loadPolicy().validate("A1b" + "x".repeat(200));
      expect(r.ok).toBe(false);
      expect(r.reasons.some((m) => m.includes("不能超过"))).toBe(true);
    });

    it("空串被拒（太短 + 缺各种）", () => {
      const r = loadPolicy().validate("");
      expect(r.ok).toBe(false);
      expect(r.reasons.length).toBeGreaterThan(0);
    });

    it("非字符串被拒", () => {
      const r = loadPolicy().validate(12345678);
      expect(r.ok).toBe(false);
      expect(r.reasons.some((m) => m.includes("字符串"))).toBe(true);
    });

    it("一次性返回全部违规", () => {
      // 短 + 纯小写 + 无数字 → 应至少 3 条
      const r = loadPolicy().validate("abc");
      expect(r.ok).toBe(false);
      expect(r.reasons.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("validate() 禁用模式", () => {
    beforeEach(() => {
      process.env.ENABLE_PASSWORD_POLICY = "false";
    });

    it("短密码通过", () => {
      expect(loadPolicy().validate("abc").ok).toBe(true);
    });

    it("弱口令通过", () => {
      expect(loadPolicy().validate("password").ok).toBe(true);
    });

    it("只有数字的短密码通过", () => {
      expect(loadPolicy().validate("123").ok).toBe(true);
    });

    it("但超长仍被拒（硬闸）", () => {
      const r = loadPolicy().validate("x".repeat(200));
      expect(r.ok).toBe(false);
      expect(r.reasons.some((m) => m.includes("不能超过"))).toBe(true);
    });

    it("非字符串仍被拒（硬闸）", () => {
      expect(loadPolicy().validate(null).ok).toBe(false);
    });
  });

  describe("黑名单常量暴露", () => {
    it("至少 10 条黑名单", () => {
      const policy = loadPolicy();
      expect(policy._constants.WEAK_PASSWORDS_COUNT).toBeGreaterThanOrEqual(10);
    });

    it("MIN_LENGTH = 8", () => {
      expect(loadPolicy()._constants.MIN_LENGTH).toBe(8);
    });
  });
});
