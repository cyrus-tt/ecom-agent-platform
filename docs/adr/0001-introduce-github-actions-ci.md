# ADR 0001: 引入 GitHub Actions CI

- 日期：2026-04-23
- 状态：已采纳
- 决策者：Cyrus（产品）+ Claude（执行）
- 关联 PR：PR1
- 关联设计：`docs/plans/2026-04-23-uplift-to-9-design.md`

## 背景

当前仓库无自动化检查：
- `package.json:15` 的 `test` 脚本是占位符：`"node -e \"console.log('No automated tests configured yet.')\""`
- `.github/workflows/` 不存在
- lint / build / test 全靠人工
- 即将给部门 40 人推广，改动频率会上升，人工检查必然漏

## 决策

引入 GitHub Actions CI，在 PR 到 `feature/dispatch-agent` / `main` 时强制跑：

1. **`node --check apps/gateway/server.js`**：语法检查（已够低成本发现大部分破坏性改动）
2. **`npm --prefix apps/web run build`**：前端真实构建
3. **`npm test`**：根测试命令（PR1 仍是占位，由 PR2 替换为 vitest 真实测试）

**约束**：
- 固定 Node 20（与 `package.json:engines` 和生产 Windows 机器一致）
- Ubuntu 跑，15 分钟超时
- 用 `actions/cache` 缓存 npm 依赖，期望单次 < 5 分钟

## 替代方案

| 方案 | 为什么没选 |
|---|---|
| 不做 CI | 40 人推广后人工漏检风险太大 |
| Husky + pre-commit | 只能约束本地提交，不能约束别人提交到仓库的 PR，不够 |
| 私有 CI（Jenkins / GitLab CI）| 需要额外基础设施、维护成本大，对部门级内部产品是过度投资 |
| CircleCI / Travis | GitHub Actions 对 GitHub 仓库零配置门槛最低 |

## 后果

- ✅ 每个 PR 有基础保障，行为劣化早发现
- ✅ 为 PR2 的测试自动化打底
- ✅ 免费额度对私有仓库每月 2000 分钟足够（估计每月 200 分钟以内）
- ⚠️ CI 跑失败时开发者等待（通常 < 5 分钟）
- ⚠️ 需要 GitHub 公共 Actions 网络可达（内网开发不受影响，但 PR 合并审核依赖 GitHub）

## 验证

合并 PR1 后，任意后续 PR 开 → GitHub Actions 页面出现 workflow 运行 → 绿。
