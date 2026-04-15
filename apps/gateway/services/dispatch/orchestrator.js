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
  CONFIRMING_SIZE: "CONFIRMING_SIZE",
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

    // 第一次调拨计算(检测尺码替代)
    await stepDispatchPlan(task, { detectSubstitutions: true });
    task = taskStore.getTask(taskId);

    if (task.meta.dispatchReport && Array.isArray(task.meta.dispatchReport.sizeSubstitutions)
        && task.meta.dispatchReport.sizeSubstitutions.length > 0) {
      await stepConfirmSize(task);
      task = taskStore.getTask(taskId);
      // 第二次调拨计算,不再检测替代
      await stepDispatchPlan(task, { detectSubstitutions: false });
      task = taskStore.getTask(taskId);
    }

    await stepRender(task);
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

async function stepDispatchPlan(task, options = {}) {
  taskStore.updateTask(task.id, { state: STATES.DISPATCHING });
  const label = options.detectSubstitutions === false ? "(复算)" : "";
  emit(task.id, "DISPATCHING", "info", `读取库存并计算调拨方案${label}...`);

  const { headers, rows } = readDemandExcel(task.meta.cleanedFile);
  const colMap = findColumns(headers);
  const { cleaned } = cleanDemandRows(rows, headers);

  const virtualRows = readE3Excel(task.meta.files.virtualStockFile);
  const physicalRows = readE3Excel(task.meta.files.physicalStockFile);
  const virtualIndex = buildVirtualIndex(virtualRows);
  const physicalIndex = buildPhysicalIndex(physicalRows);

  const base = path.basename(task.meta.files.demandFile, path.extname(task.meta.files.demandFile));
  const result = computeDispatch(
    cleaned,
    colMap,
    virtualIndex,
    physicalIndex,
    task.meta.transportMode,
    base,
    { detectSubstitutions: options.detectSubstitutions !== false }
  );

  const meta = { ...task.meta };
  meta._plan = {
    dispatchLines: result.dispatchLines,
    moveLines: result.moveLines,
    docCount: result.docCount,
    base,
  };
  meta.dispatchReport = {
    okCount: result.dispatchLines.length,
    totalQty: result.dispatchLines.reduce((s, l) => s + l.qty, 0),
    docCount: result.docCount,
    noBarcode: result.report.noBarcode,
    noStock: result.report.noStock,
    noVirtualStock: result.report.noVirtualStock,
    duplicateConfirm: result.report.duplicateConfirm,
    partialStock: result.report.partialStock,
    sizeSubstitutions: result.report.sizeSubstitutions || [],
  };
  taskStore.updateTask(task.id, { meta });

  emit(task.id, "DISPATCHED", "milestone",
    `调拨计算完成: ${result.dispatchLines.length} 行 / ${meta.dispatchReport.totalQty} 件 / ${result.docCount} 个单据` +
    (meta.dispatchReport.sizeSubstitutions.length > 0
      ? `,发现 ${meta.dispatchReport.sizeSubstitutions.length} 项可换尺码`
      : ""),
    meta.dispatchReport
  );
}

async function stepConfirmSize(task) {
  taskStore.updateTask(task.id, { state: STATES.CONFIRMING_SIZE });
  const subs = task.meta.dispatchReport.sizeSubstitutions || [];
  const issues = subs.map((s, i) => buildSizeIssue(s, i));

  const token = taskStore.createConfirmToken(task.id);
  const confirmUrl = `${getPublicUrl()}/dispatch/confirm/${task.id}?token=${token}`;

  const meta = { ...task.meta };
  meta.sizeConfirmMeta = {
    issues,
    token,
    confirmUrl,
    requestedAt: new Date().toISOString(),
  };
  taskStore.updateTask(task.id, { meta });

  emit(task.id, "SIZE_CONFIRM_REQUESTED", "milestone",
    `发现 ${issues.length} 项可换大一码的需求,已向需求人发起确认`,
    { issues, confirmUrl, dingtalkConfigured: !!dingtalk.getWebhookUrl() }
  );

  const dt = await dingtalk.sendConfirmRequest(task.title, issues, confirmUrl);
  if (dt.skipped) emit(task.id, "SIZE_CONFIRM_NO_DINGTALK", "warn", "钉钉 webhook 未配置,请直接打开确认页", { confirmUrl });
  else if (dt.ok === false) emit(task.id, "SIZE_CONFIRM_DINGTALK_FAILED", "warn", `钉钉发送失败: ${dt.error}`, { confirmUrl });
  else emit(task.id, "SIZE_CONFIRM_DINGTALK_SENT", "info", "钉钉消息已发送,等待需求人确认", { confirmUrl });

  const timeoutMs = Number(process.env.DISPATCH_CONFIRM_TIMEOUT_MS || 4 * 3600 * 1000);
  const responses = await waitForConfirm(task.id, timeoutMs);

  emit(task.id, "SIZE_CONFIRM_RECEIVED", "milestone", "已收到需求人对尺码替代的回执", { responses });

  const applyResult = applySizeDecisionsToCleanedFile(task, issues, subs, responses);
  emit(task.id, "SIZE_CONFIRM_APPLIED", "info",
    `已按回执调整需求表: 换码 ${applyResult.substitutedCount} 行,整行取消 ${applyResult.cancelledCount} 行,保持原码 ${applyResult.keptCount} 行`,
    applyResult
  );

  const meta2 = taskStore.getTask(task.id).meta;
  meta2.sizeConfirmResult = { issues, responses, ...applyResult, confirmedAt: new Date().toISOString() };
  taskStore.updateTask(task.id, { meta: meta2 });
}

function buildSizeIssue(sub, idx) {
  const options = [];
  if (sub.scenario === "A") {
    options.push({ value: "substitute", label: `整单换为 ${sub.candidate.size}(${sub.qty} 件,可发)` });
    options.push({ value: "cancel", label: `取消这行(原 ${sub.size} ${sub.qty} 件全缺,不发)` });
  } else {
    options.push({
      value: "substitute",
      label: `缺的 ${sub.missingQty} 件换为 ${sub.candidate.size}(原 ${sub.size} 照发 ${sub.fulfilled} 件)`,
    });
    options.push({
      value: "keep",
      label: `不换,只发 ${sub.size} ${sub.fulfilled} 件,缺 ${sub.missingQty} 件接受`,
    });
    options.push({
      value: "cancel",
      label: `整行取消(${sub.size} ${sub.fulfilled} 件也不发)`,
    });
  }
  return {
    id: `s_${idx}`,
    index: idx,
    type: "size_substitution",
    scenario: sub.scenario,
    sku: sub.sku,
    originalSize: sub.size,
    candidateSize: sub.candidate.size,
    qty: sub.qty,
    fulfilled: sub.fulfilled,
    missingQty: sub.missingQty,
    physicalAvailable: sub.candidate.physicalAvailable,
    virtualAvailable: sub.candidate.virtualAvailable,
    rowIndex: sub.rowIndex,
    description: sub.reason,
    options,
  };
}

function applySizeDecisionsToCleanedFile(task, issues, subs, responses) {
  const cleanedFile = task.meta.cleanedFile;
  if (!cleanedFile || !fs.existsSync(cleanedFile)) {
    return { substitutedCount: 0, cancelledCount: 0, keptCount: 0, changes: [] };
  }
  const { headers, rows } = readDemandExcel(cleanedFile);
  const colMap = findColumns(headers);

  const dropIndexes = new Set();
  const appendRows = [];
  const changes = [];
  let substitutedCount = 0;
  let cancelledCount = 0;
  let keptCount = 0;

  for (const iss of issues) {
    const key = `issue_${iss.index}`;
    const action = responses[key] || "keep";
    const sub = subs[iss.index];
    if (!sub) continue;
    const rowIdx = sub.rowIndex;

    if (action === "cancel") {
      dropIndexes.add(rowIdx);
      cancelledCount += 1;
      changes.push({ issueId: iss.id, action, rowIndex: rowIdx, sku: sub.sku, size: sub.size });
      continue;
    }
    if (action === "substitute") {
      substitutedCount += 1;
      if (sub.scenario === "A") {
        // 直接改原行的尺码为新尺码
        if (rows[rowIdx] && colMap.size >= 0) {
          rows[rowIdx][colMap.size] = sub.candidate.size;
        }
        changes.push({ issueId: iss.id, action, rowIndex: rowIdx, sku: sub.sku,
          from: sub.size, to: sub.candidate.size, qty: sub.qty });
      } else {
        // B 场景:原行数量改为 fulfilled,新增一行数量=missingQty,尺码=候选码
        if (rows[rowIdx] && colMap.qty >= 0) {
          rows[rowIdx][colMap.qty] = sub.fulfilled;
        }
        const newRow = rows[rowIdx] ? rows[rowIdx].slice() : [];
        if (colMap.size >= 0) newRow[colMap.size] = sub.candidate.size;
        if (colMap.qty >= 0) newRow[colMap.qty] = sub.missingQty;
        appendRows.push(newRow);
        changes.push({ issueId: iss.id, action, rowIndex: rowIdx, sku: sub.sku,
          keptQty: sub.fulfilled, addedSize: sub.candidate.size, addedQty: sub.missingQty });
      }
      continue;
    }
    // keep: 保持现状
    keptCount += 1;
    changes.push({ issueId: iss.id, action: "keep", rowIndex: rowIdx, sku: sub.sku, size: sub.size });
  }

  const nextRows = rows.filter((_, i) => !dropIndexes.has(i)).concat(appendRows);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...nextRows]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, cleanedFile);

  const meta = taskStore.getTask(task.id).meta;
  if (meta.cleanReport) {
    meta.cleanReport.cleanedCount = nextRows.length;
  }
  taskStore.updateTask(task.id, { meta });

  return { substitutedCount, cancelledCount, keptCount, changes };
}

async function stepRender(task) {
  taskStore.updateTask(task.id, { state: STATES.RENDERING });
  emit(task.id, "RENDERING", "info", "生成导入模板...");

  const plan = task.meta._plan || {};
  const dispatchLines = plan.dispatchLines || [];
  const moveLines = plan.moveLines || [];
  const base = plan.base || "output";
  const outDir = task.meta.outDir;
  const meta = { ...task.meta };

  if (dispatchLines.length > 0) {
    const dispatchFile = path.join(outDir, `调拨批量模板_${base}.xlsx`);
    const wb = buildDispatchWorkbook(dispatchLines);
    XLSX.writeFile(wb, dispatchFile);
    meta.dispatchTemplateFile = dispatchFile;
  }
  if (moveLines.length > 0) {
    const moveFile = path.join(outDir, `移仓单批量导入模板_${base}.csv`);
    fs.writeFileSync(moveFile, buildMoveCsv(moveLines), "utf-8");
    meta.moveTemplateFile = moveFile;
  }
  delete meta._plan;
  taskStore.updateTask(task.id, { meta });

  emit(task.id, "RENDERED", "milestone", "导入模板已生成", {
    dispatchFile: meta.dispatchTemplateFile ? path.basename(meta.dispatchTemplateFile) : null,
    moveFile: meta.moveTemplateFile ? path.basename(meta.moveTemplateFile) : null,
  });
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
