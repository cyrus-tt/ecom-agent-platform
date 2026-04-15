# 调拨 Agent 启用与运行

## 环境变量

全部可选,未设置时有默认值。只需要设 `DISPATCH_AGENT_ENABLED=true` 即可启用。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DISPATCH_AGENT_ENABLED` | `false` | 总开关,`true` 时注册路由、菜单、权限模块 |
| `DISPATCH_DATA_DIR` | `<repo>/data/dispatch` | 任务数据目录(SQLite + 上传 + 产物) |
| `DISPATCH_SAAS_PUBLIC_URL` | `http://localhost:3000` | 生成钉钉卡片确认链接用,局域网填 `http://<本机IP>:3000` |
| `DISPATCH_DINGTALK_WEBHOOK_URL` | 空 | 钉钉机器人 webhook;未配置时跳过钉钉,时间轴里可直接点"打开确认页" |
| `DISPATCH_DINGTALK_SECRET` | 空 | 钉钉加签密钥(可选) |
| `DISPATCH_CONFIRM_TIMEOUT_MS` | `14400000`(4h) | 等待需求人确认的超时时间 |

## Windows 启用步骤

1. 打开 PowerShell(管理员),进入仓库目录

2. **首次**:安装新依赖(`better-sqlite3` 要编译一次)
   ```powershell
   npm run install:all
   ```
   看到 `node-gyp` 字样是正常的。如果报错提示缺 Python/VS Build Tools,装好后重跑。

3. 设环境变量(建议写到 `ops/windows/start_all.ps1` 启动前,或者用 `.env`):
   ```powershell
   $env:DISPATCH_AGENT_ENABLED = "true"
   $env:DISPATCH_DINGTALK_WEBHOOK_URL = "https://oapi.dingtalk.com/robot/send?access_token=..."
   $env:DISPATCH_SAAS_PUBLIC_URL = "http://<你本机IP>:3000"
   ```

4. 启动(前端构建 + 网关起来):
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\windows\start_all.ps1 -RebuildWeb
   ```

5. 登录后进入 `/dispatch` 菜单(需要管理员权限或单独为账户授予 `dispatch` 模块权限)。

## 关闭功能(回到原状态)

```powershell
$env:DISPATCH_AGENT_ENABLED = "false"
```
重启网关即可,全部路由、菜单、权限模块都会消失,现有系统行为与未加功能前 100% 一致。

## 给同事账户开通权限

管理员登录 → 右上"账号权限" → 编辑同事账户 → 勾选"调拨"模块 → 保存。

## 故障排查

- 启动时看到 `[dispatch] DISPATCH_AGENT_ENABLED=false, 已跳过调拨 Agent 注册`
  → 环境变量没生效,检查 PowerShell 是否设到了同一 session
- `better-sqlite3` 编译失败
  → 装 Visual Studio Build Tools(C++ 桌面开发工作负载),装完重启再跑 `npm run install:all`
- 钉钉消息收不到
  → 确认群机器人"加签"或"关键词"校验是否匹配,webhook 里带的关键词是"调拨"
- 确认页打开提示 `token_invalid_or_expired`
  → token 默认 24 小时有效期,且只能提交一次。过期请在 SaaS 时间轴上直接打开新链接
