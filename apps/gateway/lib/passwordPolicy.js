"use strict";

/**
 * 密码策略（V2 加固 · 第 3 项）
 *
 * 动机：
 *   PR5/PR6 完成了「密码散列 + 入参形态校验」，但**强度校验**从来没做过。
 *   现状：admin 创建账号或重置密码时，schema 只保证 password 是 1-128 位字符串。
 *   即 `1`、`password`、`12345678` 都能通过 → bcrypt 散列 → 落库。
 *
 *   审计角度：一旦 auth.local.json 泄露或同事间账号互借，弱口令成为第一攻击面。
 *
 * 决策：
 *   在 zod schema 层挂一个 superRefine，调用本模块 `validate(plain)`。
 *   中文 reasons 直达前端 `issues[].message`，用户立刻能看到"需要包含数字"。
 *
 * 非目标：
 *   - 不校验登录时的密码强度（用户既存密码可能是弱的，但 policy 只对**新建/重置**生效）
 *   - 不做历史密码复用检测（需要多次 bcrypt 存档，V3 考虑）
 *   - 不做被泄库比对（haveibeenpwned 需外网，不符合内网部署约束）
 *
 * 可关：
 *   `ENABLE_PASSWORD_POLICY=false`（或 `"0"`）→ 回退到「只卡长度上限」的极简模式。
 *   保留开关是为了：
 *     1. 测试 fixture（存量弱密码 `smoke-pass` 要能继续用于**登录**，但本模块只管新建/重置，
 *        登录路径天生不会调用 validate，所以开关主要给「临时禁用于紧急运维」用）
 *     2. 上线初期若发现误伤（例如老账号批量重置），可一键退回
 */

const DEFAULT_MIN_LENGTH = 8;
const DEFAULT_MAX_LENGTH = 128;

// 弱口令黑名单。大小写不敏感。
// 来源：SecLists top-1000、本系统早期留下的默认占位值、同事会起的显而易见口令。
const WEAK_PASSWORDS = new Set(
  [
    "password",
    "password1",
    "password123",
    "12345678",
    "123456789",
    "1234567890",
    "qwerty",
    "qwerty123",
    "qwertyuiop",
    "admin",
    "admin123",
    "administrator",
    "letmein",
    "welcome",
    "welcome1",
    "000000",
    "111111",
    "abc12345",
    "iloveyou",
    "monkey",
    "dragon",
    "ecom123",
    "agent123",
    "changeme",
    "default",
    "sunshine",
  ].map((s) => s.toLowerCase())
);

function isEnabled() {
  const raw = process.env.ENABLE_PASSWORD_POLICY;
  if (raw === undefined || raw === null || raw === "") return true;
  const v = String(raw).trim().toLowerCase();
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  return true;
}

/**
 * validate(password): { ok, reasons }
 *
 * reasons 是中文、人类可读。一次性返回**全部**违规，让用户改一次就过。
 *
 * 禁用时（isEnabled() === false）：
 *   只执行最顶层的安全阀（长度上限 + 必须是字符串），不校验强度/黑名单。
 *   这样即便关了策略，也不会让 gateway 把 10MB 的"密码"塞进 bcrypt。
 */
function validate(password) {
  const reasons = [];

  if (typeof password !== "string") {
    reasons.push("密码必须是字符串");
    return { ok: false, reasons };
  }

  // 长度上限是硬闸，任何模式都要卡
  if (password.length > DEFAULT_MAX_LENGTH) {
    reasons.push(`密码不能超过 ${DEFAULT_MAX_LENGTH} 位`);
    return { ok: false, reasons };
  }

  if (!isEnabled()) {
    return { ok: true, reasons: [] };
  }

  if (password.length < DEFAULT_MIN_LENGTH) {
    reasons.push(`密码至少 ${DEFAULT_MIN_LENGTH} 位`);
  }

  if (!/[a-z]/.test(password)) {
    reasons.push("需要包含小写字母");
  }

  // 特殊字符默认不强制，保留开关常量以便后续一键打开
  // eslint-disable-next-line no-constant-condition
  if (false) {
    if (!/[^A-Za-z0-9]/.test(password)) {
      reasons.push("需要包含特殊字符");
    }
  }

  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    reasons.push("该密码属于常见弱口令，请更换");
  }

  return { ok: reasons.length === 0, reasons };
}

module.exports = {
  validate,
  isEnabled,
  // 暴露常量给测试/文档用，不暴露给业务代码
  _constants: {
    MIN_LENGTH: DEFAULT_MIN_LENGTH,
    MAX_LENGTH: DEFAULT_MAX_LENGTH,
    REQUIRE_UPPER: false,
    REQUIRE_LOWER: true,
    REQUIRE_DIGIT: false,
    REQUIRE_SPECIAL: false,
    WEAK_PASSWORDS_COUNT: WEAK_PASSWORDS.size,
  },
};
