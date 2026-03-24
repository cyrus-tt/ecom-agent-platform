(function () {
  "use strict";

  const state = {
    salesDates: [],
    isGenerating: false,
    currentReportId: 0,
  };

  const els = {
    periodType: document.getElementById("periodType"),
    startDateInput: document.getElementById("startDateInput"),
    endDateInput: document.getElementById("endDateInput"),
    generateBtn: document.getElementById("generateBtn"),
    statusBox: document.getElementById("statusBox"),
    reportMeta: document.getElementById("reportMeta"),
    reportBox: document.getElementById("reportBox"),
    refreshHistoryBtn: document.getElementById("refreshHistoryBtn"),
    historyBody: document.getElementById("historyBody"),
  };

  function setStatus(text, kind) {
    els.statusBox.textContent = text || "";
    els.statusBox.classList.remove("ok", "bad");
    if (kind === "ok") {
      els.statusBox.classList.add("ok");
    } else if (kind === "bad") {
      els.statusBox.classList.add("bad");
    }
  }

  function setGenerating(loading) {
    state.isGenerating = !!loading;
    els.generateBtn.disabled = state.isGenerating;
    els.generateBtn.textContent = state.isGenerating ? "生成中..." : "生成分析";
  }

  async function api(url, options) {
    const resp = await fetch(url, {
      cache: "no-store",
      ...(options || {}),
      headers: {
        Accept: "application/json",
        ...((options && options.headers) || {}),
      },
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data.message || `请求失败: ${resp.status}`);
    }
    return data;
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function inlineMarkdown(text) {
    return escapeHtml(text)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  }

  function parseTableBlock(lines) {
    if (lines.length < 2) {
      return "";
    }
    const sep = lines[1].trim();
    if (!/^\|?[\s:\-|\t]+\|?$/.test(sep) || sep.indexOf("-") < 0) {
      return "";
    }
    const rows = lines
      .filter((line, idx) => idx !== 1)
      .map((line) =>
        line
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => inlineMarkdown(cell.trim()))
      )
      .filter((cells) => cells.length > 0);

    if (rows.length <= 1) {
      return "";
    }

    const header = rows[0];
    const body = rows.slice(1);
    return [
      "<table>",
      "<thead>",
      `<tr>${header.map((cell) => `<th>${cell}</th>`).join("")}</tr>`,
      "</thead>",
      "<tbody>",
      ...body.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`),
      "</tbody>",
      "</table>",
    ].join("");
  }

  function markdownToHtml(markdown) {
    const lines = String(markdown || "").split(/\r?\n/);
    const html = [];
    let i = 0;
    let inCode = false;
    let codeLines = [];
    let listType = "";

    function closeList() {
      if (!listType) {
        return;
      }
      html.push(listType === "ul" ? "</ul>" : "</ol>");
      listType = "";
    }

    while (i < lines.length) {
      const line = lines[i];

      if (/^```/.test(line.trim())) {
        closeList();
        if (!inCode) {
          inCode = true;
          codeLines = [];
        } else {
          inCode = false;
          html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
          codeLines = [];
        }
        i += 1;
        continue;
      }

      if (inCode) {
        codeLines.push(line);
        i += 1;
        continue;
      }

      const tableBlock = [];
      let j = i;
      while (j < lines.length && lines[j].includes("|")) {
        tableBlock.push(lines[j]);
        j += 1;
      }
      if (tableBlock.length >= 2) {
        const tableHtml = parseTableBlock(tableBlock);
        if (tableHtml) {
          closeList();
          html.push(tableHtml);
          i = j;
          continue;
        }
      }

      const trimmed = line.trim();
      if (!trimmed) {
        closeList();
        i += 1;
        continue;
      }

      const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        closeList();
        const level = heading[1].length;
        html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
        i += 1;
        continue;
      }

      const ul = trimmed.match(/^[-*]\s+(.+)$/);
      if (ul) {
        if (listType !== "ul") {
          closeList();
          html.push("<ul>");
          listType = "ul";
        }
        html.push(`<li>${inlineMarkdown(ul[1])}</li>`);
        i += 1;
        continue;
      }

      const ol = trimmed.match(/^\d+\.\s+(.+)$/);
      if (ol) {
        if (listType !== "ol") {
          closeList();
          html.push("<ol>");
          listType = "ol";
        }
        html.push(`<li>${inlineMarkdown(ol[1])}</li>`);
        i += 1;
        continue;
      }

      closeList();
      html.push(`<p>${inlineMarkdown(trimmed)}</p>`);
      i += 1;
    }

    closeList();
    if (inCode) {
      html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    }
    return html.join("\n");
  }

  function formatPeriodRange(item) {
    const start = String(item.period_start || "");
    const end = String(item.period_end || "");
    return start && end ? `${start} ~ ${end}` : "-";
  }

  function formatTime(value) {
    const d = new Date(value || "");
    if (Number.isNaN(d.getTime())) {
      return "-";
    }
    return d.toLocaleString("zh-CN", { hour12: false });
  }

  function applyDefaultRange() {
    const latest = state.salesDates[0] || "";
    if (!latest) {
      return;
    }
    const period = String(els.periodType.value || "week");
    const end = new Date(`${latest}T00:00:00`);
    if (Number.isNaN(end.getTime())) {
      return;
    }

    let days = 7;
    if (period === "day") {
      days = 1;
    } else if (period === "month") {
      days = 30;
    }
    const start = new Date(end.getTime());
    start.setDate(start.getDate() - (days - 1));

    const minDate = state.salesDates[state.salesDates.length - 1] || "";
    const maxDate = latest;
    els.startDateInput.min = minDate;
    els.startDateInput.max = maxDate;
    els.endDateInput.min = minDate;
    els.endDateInput.max = maxDate;

    const formatDate = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    };

    const startText = formatDate(start) < minDate ? minDate : formatDate(start);
    els.startDateInput.value = startText;
    els.endDateInput.value = latest;
  }

  function renderReport(report) {
    if (!report) {
      els.reportMeta.textContent = "-";
      els.reportBox.innerHTML = '<p class="muted">暂无报告。</p>';
      return;
    }
    const range = `${report.period_start || "-"} ~ ${report.period_end || "-"}`;
    els.reportMeta.textContent = `ID: ${report.id || "-"} | 周期: ${report.period_type || "-"} | 范围: ${range} | 创建: ${formatTime(report.created_at)}`;
    els.reportBox.innerHTML = markdownToHtml(report.report_md || "");
    state.currentReportId = Number(report.id || 0);
  }

  function renderHistory(items) {
    els.historyBody.innerHTML = "";
    if (!Array.isArray(items) || items.length === 0) {
      els.historyBody.innerHTML = '<tr><td colspan="6">暂无数据</td></tr>';
      return;
    }
    items.forEach((item) => {
      const tr = document.createElement("tr");
      tr.innerHTML = [
        `<td>${item.id}</td>`,
        `<td>${item.period_type || "-"}</td>`,
        `<td>${formatPeriodRange(item)}</td>`,
        `<td>${item.status || "-"}</td>`,
        `<td>${formatTime(item.created_at)}</td>`,
        `<td><button type="button" data-id="${item.id}">查看</button></td>`,
      ].join("");
      els.historyBody.appendChild(tr);
    });
  }

  async function loadHistory() {
    const data = await api("/api/agent/reports?page=1&pageSize=20");
    renderHistory(data.items || []);
    const first = (data.items || [])[0];
    if (first && (!state.currentReportId || Number(first.id) !== state.currentReportId)) {
      await loadReportDetail(first.id);
    }
  }

  async function loadReportDetail(id) {
    const data = await api(`/api/agent/reports/${encodeURIComponent(id)}`);
    renderReport(data.report || null);
  }

  async function generateReport() {
    if (state.isGenerating) {
      return;
    }
    const periodType = String(els.periodType.value || "week");
    const startDate = String(els.startDateInput.value || "").trim();
    const endDate = String(els.endDateInput.value || "").trim();
    if (!startDate || !endDate) {
      setStatus("请先选择开始和结束日期。", "bad");
      return;
    }

    try {
      setGenerating(true);
      setStatus("正在计算指标并生成分析，请稍候...", "");
      const data = await api("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          period_type: periodType,
          start_date: startDate,
          end_date: endDate,
        }),
      });
      if (data.ok === false) {
        setStatus(data.message || "生成失败。", "bad");
        return;
      }
      renderReport({
        id: data.report_id,
        period_type: periodType,
        period_start: startDate,
        period_end: endDate,
        report_md: data.report_md,
        created_at: data.created_at,
      });
      setStatus(`生成成功，报告 ID: ${data.report_id}`, "ok");
      await loadHistory();
    } catch (err) {
      setStatus(err && err.message ? err.message : "生成失败", "bad");
    } finally {
      setGenerating(false);
    }
  }

  async function loadSalesDates() {
    const data = await api("/api/report-daily/dates");
    state.salesDates = Array.isArray(data.sales_dates) ? data.sales_dates : [];
    applyDefaultRange();
  }

  function bindEvents() {
    els.periodType.addEventListener("change", () => {
      applyDefaultRange();
    });
    els.generateBtn.addEventListener("click", () => {
      generateReport();
    });
    els.refreshHistoryBtn.addEventListener("click", () => {
      loadHistory().catch((err) => setStatus(err.message || String(err), "bad"));
    });
    els.historyBody.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.tagName !== "BUTTON") {
        return;
      }
      const id = Number(target.getAttribute("data-id") || 0);
      if (!id) {
        return;
      }
      loadReportDetail(id).catch((err) => setStatus(err.message || String(err), "bad"));
    });
  }

  async function init() {
    bindEvents();
    try {
      await loadSalesDates();
      await loadHistory();
      setStatus("就绪，可开始生成分析报告。", "ok");
    } catch (err) {
      setStatus(err && err.message ? err.message : "初始化失败", "bad");
    }
  }

  init();
})();
