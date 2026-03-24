# ENGINEERING_STANDARD

## 1. 单一根目录原则
- 仅以 `D:\桌面\ecom-agent-platform` 作为工程主目录。
- 旧目录仅保留历史，不再做新开发与新数据导入。

## 2. 数据路径规范
- 新数据只放 `data/inbox`。
- 运行 `pipelines/pg-daily-wide` 完成 prepare/load/etl/split。
- 完成入库后原始文件移至 `data/archive`（建议按月压缩）。

## 3. 前后端开发规范
- 后端改动：`apps/gateway`
- 前端改动：`apps/web`
- 不在 `public` 新增业务页面，除兼容页外统一走 React。

## 4. 配置与密钥
- 真实密钥只放本机环境变量或本地私有配置。
- 仓库内仅保留 `.env.example` / 配置模板。

## 5. 发布与回滚
- 发布前：执行前端 build 与后端健康检查。
- 回滚：保持上一版 `apps/web/dist` 与后端版本快照。

## 6. 每日操作建议
1. 将新增 CSV/XLSX 放入 `data/inbox`
2. 运行 prepare 脚本
3. 执行 SQL：`01 -> 02 -> 03 -> 05`
4. 核对销售日期范围与行数
5. 重启网关服务并前端强刷缓存