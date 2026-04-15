"use strict";

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const taskStore = require("./taskStore");
const eventBus = require("./eventBus");
const dingtalk = require("./dingtalk");
const { cleanDemandRows, findColumns, extractUniqueSkus } = require("./steps/clean");
const { buildVirtualIndex, buildPhysicalIndex, computeDispatch } = require("./steps/dispatch");
const { buildDispatchWorkbook, buildMoveCsv } = require("./steps/template");

const STATES = {
  RECEIVED: "RECEIVED",
  CLEANING: "CLEANING",
  CONFIRMING: "CONFIRMING",
  DISPATCHING: "DISPATCHING",
  RENDERING: "RENDERING",
  DONE: "DONE",
  FAILED: "FAILED",
};

// 等待确认的 resolver 表: taskId -> { resolve, timer }
const pendingConfirms = new Map();

function emit(taskId, phase, level, message, payload) {
  return eventBus.publish(taskId, { phase, level, message, payload });
}

function readDemandExcel(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  const headers = (data[0] || []).map((h) => String(h || "").trim());
  const rows = data.slice(1).filter((r) => r.some((c) => String(c || "").trim() !== ""));
  return { headers, rows };
}

function readE3Excel(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { raw: false, defval: "" });
}

function getPublicUrl() {
  return String(process.env.DISPATCH_SAAS_PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "");
}

async function startTask({ taskId, title, demandFile, virtualStockFile, physicalStockFile, createdBy, outDir }) {
  const now = new Date().toISOString();
  const task = {
    id: taskId,
    title,
    state: STATES.RECEIVED,
    createdBy: createdBy || "",
    createdAt: now,
    updatedAt: now,
    error: null,
    meta: {
      files: { demandFile, virtualStockFile, physicalStockFile },
      outDir,
      transportMode: "陆运快递",
      cleanReport: null,
      dispatchReport: null,
      cleanedFile: null,
      dispatchTemplateFile: null,
      moveTemplateFile: null,
    },
  };
  taskStore.insertTask(task);
  emit(taskId, "TASK_CREATED", "milestone", `任务已创建: ${title}`, {
    files: task.meta.files,
  });
  // 异步执行,不阻塞接口
  runTask(taskId).catch((err) => {
    console.error(`[dispatch] task ${taskId} fatal:`, err);
  });
  return task;
}

async function runTask(taskId) {
  let task = taskStore.getTask(taskId);
  if (!task) return;
  try {
    await stepClean(task);
    task = taskStore.getTask(taskId);

    if (task.meta.cleanReport && task.meta.cleanReport.warnings && task.meta.cleanReport.warnings.length > 0) {
      await stepConfirm(task);
      task = taskStore.getTask(taskId);
    }

    await stepDispatch(task);
    task = taskStore.getTask(taskId);

    taskStore.updateTask(taskId, { state: STATES.DONE });
    emit(taskId, "TASK_DONE", "milestone", "任务完成 ✅", {
      artifacts: collectArtifacts(task),
    });
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    taskStore.updateTask(taskId, { state: STATES.FAILED, error: message });
    emit(taskId, "TASK_FAILED", "error", `任务失败: ${message}`, { error: message });
    // 通知钉钉
    dingtalk.sendMarkdown(`调拨失败-${task.title}`,
      `### 调拨任务失败\n\n- 任务: ${task.title}\n- 错误: ${message}`
    ).catch(() => {});
  }
}

async function stepClean(task) {
  taskStore.updateTask(task.id, { state: STATES.CLEANING });
  emit(task.id, "CLEANING", "info", "开始清洗需求表...");

  const { headers, rows } = readDemandExcel(task.meta.files.demandFile);
  const { cleaned, fixes, warnings, cleanedRowNums } = cleanDemandRows(rows, headers);

  const outDir = task.meta.outDir;
  const base = path.basename(task.meta.files.demandFile, path.extname(task.meta.files.demandFile));
  const cleanedFile = path.join(outDir, `${base}_cleaned.xlsx`);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...cleaned]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, cleanedFile);

  const meta = { ...task.meta };
  meta.cleanedFile = cleanedFile;
  meta.cleanReport = {
    fixes,
    warnings,
    rowNums: cleanedRowNums,
    originalCount: rows.length,
    cleanedCount: cleaned.length,
  };
  taskStore.updateTask(task.id, { meta });

  emit(task.id, "CLEANED", "milestone",
    `清洗完成: ${rows.length} → ${cleaned.length} 行,修复 ${fixes.length} 处,${warnings.length} 待确认`,
    {
      originalCount: rows.length,
      cleanedCount: cleaned.length,
      fixes,
      warnings,
      cleanedFile: path.basename(cleanedFile),
    }
  );
}

async function stepConfirm(task) {
  taskStore.updateTask(task.id, { state: STATES.CONFIRMING });
  const warnings = task.meta.cleanReport.warnings;
  const issues = buildConfirmIssues(warnings);

  const token = taskStore.createConfirmToken(task.id);
  const confirmUrl = `${getPublicUrl()}/dispatch/confirm/${task.id}?token=${token}`;

  const meta = { ...task.meta };
  meta.confirmMeta = {
    issues,
    token,
    confirmUrl,
    requestedAt: new Date().toISOString(),
  };
  taskStore.updateTask(task.id, { meta });

  emit(task.id, "CONFIRM_REQUESTED", "milestone",
    `发现 ${issues.length} 项异常,已向需求人发起确认`,
    { issues, confirmUrl, dingtalkConfigured: !!dingtalk.getWebhookUrl() }
  );

  // 发钉钉
  const dtResult = await dingtalk.sendConfirmRequest(task.title, issues, confirmUrl);
  if (dtResult.skipped) {
    emit(task.id, "CONFIRM_NO_DINGTALK", "warn",
      "钉钉 webhook 未配置,请直接打开确认页",
      { confirmUrl }
    );
  } else if (dtResult.ok === false) {
    emit(task.id, "CONFIRM_DINGTALK_FAILED", "warn",
      `钉钉发送失败: ${dtResult.error}`,
      { confirmUrl }
    );
  } else {
    emit(task.id, "CONFIRM_DINGTALK_SENT", "info",
      "钉钉消息已发送,等待需求人确认",
      { confirmUrl }
    );
  }

  // 等回执(最多 4 小时,可配置)
  const timeoutMs = Number(process.env.DISPATCH_CONFIRM_TIMEOUT_MS || 4 * 3600 * 1000);
  const responses = await waitForConfirm(task.id, timeoutMs);

  emit(task.id, "CONFIRM_RECEIVED", "milestone",
    `已收到需求人回执`,
    { responses }
  );

  // 回写 cleanedFile
  const applyResult = applyConfirmToCleanedFile(task, issues, responses);
  emit(task.id, "CONFIRM_APPLIED", "info",
    `已按回执调整需求表: 删除 ${applyResult.droppedCount} 行`,
    applyResult
  );

  const meta2 = taskStore.getTask(task.id).meta;
  meta2.confirmResult = { issues, responses, ...applyResult, confirmedAt: new Date().toISOString() };
  taskStore.updateTask(task.id, { meta: meta2 });
}

function buildConfirmIssues(warnings) {
  return warnings.map((warning, i) => {
    const text = String(warning || "");
    const isDuplicate = text.includes("疑似重复");
    const match = text.match(/第\s*(\d+)\s*行/);
    const rowNum = match ? Number(match[1]) : null;
    return {
      id: `w_${i}`,
      index: i,
      rowNum,
      description: text,
      type: isDuplicate ? "duplicate" : "generic",
      options: [
        { value: "keep", label: isDuplicate ? "保留(按原数量)" : "确认无误,保留" },
        { value: "drop", label: "删除此行" },
      ],
    };
  });
}

function waitForConfirm(taskId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingConfirms.delete(taskId);
      reject(new Error(`确认超时(${Math.round(timeoutMs / 60000)}分钟)`));
    }, timeoutMs);
    pendingConfirms.set(taskId, { resolve, timer });
  });
}

function submitConfirm(taskId, responses) {
  const pending = pendingConfirms.get(taskId);
  if (!pending) return { ok: false, reason: "no_pending" };
  clearTimeout(pending.timer);
  pendingConfirms.delete(taskId);
  pending.resolve(responses);
  return { ok: true };
}

function applyConfirmToCleanedFile(task, issues, responses) {
  const cleanedFile = task.meta.cleanedFile;
  if (!cleanedFile || !fs.existsSync(cleanedFile)) {
    return { droppedCount: 0, droppedRowNums: [] };
  }
  const { headers, rows } = readDemandExcel(cleanedFile);
  const rowNums = Array.isArray(task.meta.cleanReport.rowNums) && task.meta.cleanReport.rowNums.length === rows.length
    ? task.meta.cleanReport.rowNums.slice()
    : rows.map((_, idx) => idx + 2);

  const dropIndexes = new Set();
  const droppedRowNums = [];
  for (const issue of issues) {
    const key = `issue_${issue.index}`;
    const action = responses[key];
    if (action !== "drop") continue;
    if (!Number.isFinite(issue.rowNum)) continue;
    const idx = rowNums.findIndex((rn, i) => rn === issue.rowNum && !dropIndexes.has(i));
    if (idx < 0) continue;
    dropIndexes.add(idx);
    droppedRowNums.push(issue.rowNum);
  }

  if (dropIndexes.size === 0) {
    return { droppedCount: 0, droppedRowNums: [] };
  }

  const nextRows = rows.filter((_, i) => !dropIndexes.has(i));
  const nextRowNums = rowNums.filter((_, i) => !dropIndexes.has(i));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...nextRows]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, cleanedFile);

  // 更新 meta
  const meta = taskStore.getTask(task.id).meta;
  meta.cleanReport.rowNums = nextRowNums;
  meta.cleanReport.cleanedCount = nextRows.length;
  taskStore.updateTask(task.id, { meta });

  return { droppedCount: dropIndexes.size, droppedRowNums };
}

async function stepDispatch(task) {
  taskStore.updateTask(task.id, { state: STATES.DISPATCHING });
  emit(task.id, "DISPATCHING", "info", "读取库存并计算调拨方案...");

  const { headers, rows } = readDemandExcel(task.meta.cleanedFile);
  const colMap = findColumns(headers);
  const { cleaned } = cleanDemandRows(rows, headers);

  const virtualRows = readE3Excel(task.meta.files.virtualStockFile);
  const physicalRows = readE3Excel(task.meta.files.physicalStockFile);
  const virtualIndex = buildVirtualIndex(virtualRows);
  const physicalIndex = buildPhysicalIndex(physicalRows);

  const base = path.basename(task.meta.files.demandFile, path.extname(task.meta.files.demandFile));
  const result = computeDispatch(cleaned, colMap, virtualIndex, physicalIndex, task.meta.transportMode, base);

  taskStore.updateTask(task.id, { state: STATES.RENDERING });
  emit(task.id, "RENDERING", "info", "生成导入模板...");

  const outDir = task.meta.outDir;
  const meta = { ...task.meta };

  if (result.dispatchLines.length > 0) {
    const dispatchFile = path.join(outDir, `调拨批量模板_${base}.xlsx`);
    const wb = buildDispatchWorkbook(result.dispatchLines);
    XLSX.writeFile(wb, dispatchFile);
    meta.dispatchTemplateFile = dispatchFile;
  }
  if (result.moveLines.length > 0) {
    const moveFile = path.join(outDir, `移仓单批量导入模板_${base}.csv`);
    fs.writeFileSync(moveFile, buildMoveCsv(result.moveLines), "utf-8");
    meta.moveTemplateFile = moveFile;
  }

  meta.dispatchReport = {
    okCount: result.dispatchLines.length,
    totalQty: result.dispatchLines.reduce((s, l) => s + l.qty, 0),
    docCount: result.docCount,
    noBarcode: result.report.noBarcode,
    noStock: result.report.noStock,
    noVirtualStock: result.report.noVirtualStock,
    duplicateConfirm: result.report.duplicateConfirm,
    partialStock: result.report.partialStock,
  };
  taskStore.updateTask(task.id, { meta });

  emit(task.id, "DISPATCHED", "milestone",
    `调拨计算完成: ${result.dispatchLines.length} 行 / ${meta.dispatchReport.totalQty} 件 / ${result.docCount} 个单据`,
    meta.dispatchReport
  );
}

function collectArtifacts(task) {
  const items = [];
  const m = task.meta;
  if (m.cleanedFile && fs.existsSync(m.cleanedFile)) {
    items.push({ name: path.basename(m.cleanedFile), kind: "cleaned" });
  }
  if (m.dispatchTemplateFile && fs.existsSync(m.dispatchTemplateFile)) {
    items.push({ name: path.basename(m.dispatchTemplateFile), kind: "dispatch_template" });
  }
  if (m.moveTemplateFile && fs.existsSync(m.moveTemplateFile)) {
    items.push({ name: path.basename(m.moveTemplateFile), kind: "move_template" });
  }
  return items;
}

module.exports = {
  STATES,
  startTask,
  submitConfirm,
  collectArtifacts,
};
