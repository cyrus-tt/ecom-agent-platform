"use strict";

/**
 * Auto-report — generates a downloadable Excel report from inspection results.
 *
 * After each inspection, produces a report schema compatible with excelBuilder.
 * The report is saved to the inspections table (findings.report_schema) and
 * served via API for direct download without chat interaction.
 */

const { buildBuffer } = require("../../lib/report/excelBuilder");

function buildInspectionReportSchema(inspection, anomalies, proposals) {
  const runDate = inspection.run_date || new Date().toISOString().slice(0, 10);
  const title = `Agent 巡检报告 ${runDate}`;

  const sheets = [];

  // Sheet 1: Anomaly summary
  if (anomalies.length > 0) {
    sheets.push({
      name: "异常汇总",
      columns: [
        { header: "严重度", key: "severity", width: 10, type: "text" },
        { header: "类型", key: "type_label", width: 15, type: "text" },
        { header: "标题", key: "title", width: 35, type: "text" },
        { header: "当前值", key: "metric_current", width: 12, type: "number" },
        { header: "前期值", key: "metric_previous", width: 12, type: "number" },
        { header: "变化率", key: "change_pct", width: 10, type: "percent", conditional: { negative: "red", positive: "green" } },
        { header: "建议操作", key: "suggested_action", width: 40, type: "text" },
        { header: "状态", key: "status", width: 10, type: "text" },
      ],
      data: anomalies.map((a) => ({
        severity: severityLabel(a.severity),
        type_label: typeLabel(a.type),
        title: a.title,
        metric_current: a.metric_current,
        metric_previous: a.metric_previous,
        change_pct: a.change_pct != null ? a.change_pct / 100 : null,
        suggested_action: a.suggested_action,
        status: statusLabel(a.status),
      })),
      options: {
        freezeRow: 1,
        autoFilter: true,
        sortBy: { key: "severity", order: "asc" },
      },
    });
  }

  // Sheet 2: Proposals (if any)
  if (proposals && proposals.length > 0) {
    sheets.push({
      name: "Agent 建议",
      columns: [
        { header: "风险等级", key: "risk_level", width: 10, type: "text" },
        { header: "操作类型", key: "action_type", width: 12, type: "text" },
        { header: "建议内容", key: "title", width: 40, type: "text" },
        { header: "详情", key: "description", width: 40, type: "text" },
        { header: "状态", key: "status", width: 10, type: "text" },
      ],
      data: proposals.map((p) => ({
        risk_level: riskLabel(p.risk_level),
        action_type: actionLabel(p.action_type),
        title: p.title,
        description: p.description || "",
        status: proposalStatusLabel(p.status),
      })),
      options: { freezeRow: 1, autoFilter: true },
    });
  }

  // Sheet 3: Summary stats
  sheets.push({
    name: "统计",
    columns: [
      { header: "指标", key: "metric", width: 25, type: "text" },
      { header: "数值", key: "value", width: 15, type: "text" },
    ],
    data: [
      { metric: "巡检日期", value: runDate },
      { metric: "异常总数", value: String(anomalies.length) },
      { metric: "严重", value: String(anomalies.filter((a) => a.severity === "critical").length) },
      { metric: "警告", value: String(anomalies.filter((a) => a.severity === "warning").length) },
      { metric: "信息", value: String(anomalies.filter((a) => a.severity === "info").length) },
      { metric: "待审批建议", value: String((proposals || []).filter((p) => p.status === "pending").length) },
      { metric: "已执行建议", value: String((proposals || []).filter((p) => p.status === "executed").length) },
    ],
    options: { freezeRow: 1, autoFilter: false },
  });

  return { title, sheets };
}

async function generateReportBuffer(inspection, anomalies, proposals) {
  const schema = buildInspectionReportSchema(inspection, anomalies, proposals);
  return buildBuffer(schema);
}

function severityLabel(s) {
  return { critical: "严重", warning: "警告", info: "信息" }[s] || s;
}

function typeLabel(t) {
  const map = {
    sales_drop_dod: "日环比下跌",
    sales_drop_wow: "周环比下跌",
    zero_sales_sku: "零销SKU",
    new_product_underperform: "新品滞销",
  };
  return map[t] || t;
}

function statusLabel(s) {
  return { open: "待处理", acknowledged: "已确认", resolved: "已解决" }[s] || s;
}

function riskLabel(r) {
  return { high: "高", medium: "中", low: "低" }[r] || r;
}

function actionLabel(t) {
  const map = {
    notify: "通知",
    acknowledge: "确认",
    investigate: "排查",
    adjust_inventory: "库存调整",
    create_promotion: "推广",
  };
  return map[t] || t;
}

function proposalStatusLabel(s) {
  return { pending: "待审批", approved: "已批准", executed: "已执行", rejected: "已拒绝", failed: "失败" }[s] || s;
}

module.exports = { buildInspectionReportSchema, generateReportBuffer };
