"use strict";

// Facade: 全部公共 API 由 ./report/index.js 聚合提供。
// 详见 docs/adr/0014-reportRepo-split.md 与 docs/plans/2026-04-25-v3-reportRepo-split-plan.md。
module.exports = require("./report");
