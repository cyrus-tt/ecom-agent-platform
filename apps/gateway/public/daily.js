(function () {
  "use strict";

  const state = {
    salesDates: [],
    dateFrom: "",
    dateTo: "",
    page: 1,
    pageSize: 50,
    keyword: "",
    total: 0,
    meta: null,
    rows: [],
  };

  const els = {
    loading: document.getElementById("loading"),
    dateFromInput: document.getElementById("dateFromInput"),
    dateToInput: document.getElementById("dateToInput"),
    keywordInput: document.getElementById("keywordInput"),
    searchBtn: document.getElementById("searchBtn"),
    resetBtn: document.getElementById("resetBtn"),
    pageSizeSelect: document.getElementById("pageSizeSelect"),
    exportBtn: document.getElementById("exportBtn"),
    tableHead: document.getElementById("tableHead"),
    tableBody: document.getElementById("tableBody"),
    metaLine: document.getElementById("metaLine"),
    gapLine: document.getElementById("gapLine"),
    prevBtn: document.getElementById("prevBtn"),
    nextBtn: document.getElementById("nextBtn"),
    pageInfo: document.getElementById("pageInfo"),
  };
  const preview = {
    root: null,
    title: null,
    status: null,
    img: null,
  };

  function setLoading(loading) {
    els.loading.style.display = loading ? "block" : "none";
  }

  async function api(path) {
    const res = await fetch(path, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.message || "请求失败");
    }
    return data;
  }

  function formatValue(value, index) {
    if (value === null || value === undefined || value === "") {
      return "";
    }
    if (typeof value !== "number") {
      return String(value);
    }

    if (index >= 61) {
      return value.toFixed(4);
    }
    if (Math.abs(value - Math.round(value)) < 1e-9) {
      return String(Math.round(value));
    }
    return value.toFixed(2);
  }

  function renderHead(groupHeaders, columnHeaders) {
    const tr1 = document.createElement("tr");
    groupHeaders.forEach((v) => {
      const th = document.createElement("th");
      th.textContent = v || "";
      tr1.appendChild(th);
    });

    const tr2 = document.createElement("tr");
    columnHeaders.forEach((v) => {
      const th = document.createElement("th");
      th.textContent = v || "";
      tr2.appendChild(th);
    });

    els.tableHead.innerHTML = "";
    els.tableHead.appendChild(tr1);
    els.tableHead.appendChild(tr2);
  }

  function ensureSkuPreview() {
    if (preview.root) {
      return;
    }

    const root = document.createElement("div");
    root.className = "sku-preview-float";

    const title = document.createElement("div");
    title.className = "sku-preview-float-title";

    const status = document.createElement("div");
    status.className = "sku-preview-float-status";

    const img = document.createElement("img");
    img.className = "sku-preview-float-image";
    img.alt = "SKU preview";
    img.addEventListener("load", () => {
      status.textContent = "";
      img.style.display = "block";
    });
    img.addEventListener("error", () => {
      status.textContent = "暂无图片";
      img.style.display = "none";
    });

    root.appendChild(title);
    root.appendChild(status);
    root.appendChild(img);
    document.body.appendChild(root);

    preview.root = root;
    preview.title = title;
    preview.status = status;
    preview.img = img;
  }

  function positionSkuPreview(clientX, clientY) {
    if (!preview.root) {
      return;
    }
    const margin = 18;
    const rect = preview.root.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const left = Math.min(clientX + 16, maxLeft);
    const top = Math.min(clientY + 16, maxTop);
    preview.root.style.left = `${left}px`;
    preview.root.style.top = `${top}px`;
  }

  function hideSkuPreview() {
    if (!preview.root) {
      return;
    }
    preview.root.classList.remove("is-visible");
  }

  function showSkuPreview(sku, evt) {
    const safeSku = String(sku || "").trim();
    if (!safeSku) {
      hideSkuPreview();
      return;
    }
    ensureSkuPreview();
    preview.title.textContent = `货号：${safeSku}`;
    preview.status.textContent = "正在加载图片...";
    preview.img.style.display = "none";
    preview.img.src = `/api/image/${encodeURIComponent(safeSku)}`;
    preview.root.classList.add("is-visible");
    positionSkuPreview(evt.clientX, evt.clientY);
  }

  function bindSkuPreview(node, sku) {
    node.className = "sku-hover-trigger";
    node.addEventListener("mouseenter", (evt) => showSkuPreview(sku, evt));
    node.addEventListener("mousemove", (evt) => positionSkuPreview(evt.clientX, evt.clientY));
    node.addEventListener("mouseleave", hideSkuPreview);
  }

  function renderRows(items, colCount) {
    els.tableBody.innerHTML = "";
    if (!items.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = colCount;
      td.textContent = "当前条件无数据";
      tr.appendChild(td);
      els.tableBody.appendChild(tr);
      return;
    }

    items.forEach((row) => {
      const tr = document.createElement("tr");
      row.forEach((cell, idx) => {
        const td = document.createElement("td");
        const text = formatValue(cell, idx);
        if (idx === 2 && text) {
          const span = document.createElement("span");
          span.textContent = text;
          bindSkuPreview(span, text);
          td.appendChild(span);
        } else {
          td.textContent = text;
        }
        tr.appendChild(td);
      });
      els.tableBody.appendChild(tr);
    });
  }

  function renderMeta() {
    if (!state.meta) {
      els.metaLine.textContent = "-";
      els.gapLine.textContent = "-";
      return;
    }

    const m = state.meta;
    els.metaLine.textContent =
      `销售日期: ${state.dateFrom} 至 ${state.dateTo} | 行数: ${m.row_count || state.total} | ` +
      `最新库存快照日期: ${m.inventory_date || "-"} | 生成时间: ${m.generated_at || "-"}`;

    const gap = m.gap_summary || {};
    const gapText =
      `映射缺口: 门店渠道 ${gap.missing_store_channel || 0} / 分配池渠道 ${gap.missing_pool_channel || 0} / ` +
      `分配池比例 ${gap.missing_pool_ratio || 0} / 库存未知渠道 ${gap.unknown_inventory_channel || 0} / ` +
      `销售未知渠道 ${gap.unknown_sales_channel || 0}`;
    els.gapLine.textContent = gapText;
    els.gapLine.className = "gap-warn";
  }

  function renderPageInfo() {
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    els.pageInfo.textContent = `第 ${state.page} / ${totalPages} 页，共 ${state.total} 行`;
    els.prevBtn.disabled = state.page <= 1;
    els.nextBtn.disabled = state.page >= totalPages;
  }

  function applyRangeToInputs() {
    els.dateFromInput.value = state.dateFrom || "";
    els.dateToInput.value = state.dateTo || "";
  }

  async function loadDates() {
    const data = await api("/api/report-daily/dates");
    state.salesDates = data.sales_dates || [];

    const fallback = data.default_sales_date || state.salesDates[0] || "";
    state.dateFrom = fallback;
    state.dateTo = fallback;

    if (state.salesDates.length > 0) {
      const minDate = state.salesDates[state.salesDates.length - 1];
      const maxDate = state.salesDates[0];
      els.dateFromInput.min = minDate;
      els.dateFromInput.max = maxDate;
      els.dateToInput.min = minDate;
      els.dateToInput.max = maxDate;
    }

    applyRangeToInputs();
  }

  function normalizeRangeFromInputs() {
    let from = String(els.dateFromInput.value || "").trim();
    let to = String(els.dateToInput.value || "").trim();

    if (!from && !to) {
      from = state.salesDates[0] || "";
      to = from;
    } else if (!from) {
      from = to;
    } else if (!to) {
      to = from;
    }

    if (from && to && from > to) {
      const t = from;
      from = to;
      to = t;
    }

    state.dateFrom = from;
    state.dateTo = to;
    applyRangeToInputs();
  }

  async function loadMetaAndRows() {
    normalizeRangeFromInputs();
    if (!state.dateFrom || !state.dateTo) {
      return;
    }

    setLoading(true);
    try {
      const dateFromQ = encodeURIComponent(state.dateFrom);
      const dateToQ = encodeURIComponent(state.dateTo);
      const keywordQ = encodeURIComponent(state.keyword);

      const meta = await api(`/api/report-daily/meta?dateFrom=${dateFromQ}&dateTo=${dateToQ}`);
      state.meta = meta;

      const rows = await api(
        `/api/report-daily/rows?dateFrom=${dateFromQ}&dateTo=${dateToQ}&page=${state.page}&pageSize=${state.pageSize}&keyword=${keywordQ}`
      );
      state.rows = rows.items || [];
      state.total = rows.total || 0;

      renderHead(meta.group_headers || [], meta.column_headers || []);
      renderRows(state.rows, (meta.column_headers || []).length || 101);
      renderMeta();
      renderPageInfo();
    } finally {
      setLoading(false);
    }
  }

  function bindEvents() {
    els.searchBtn.addEventListener("click", () => {
      state.keyword = els.keywordInput.value.trim();
      state.page = 1;
      loadMetaAndRows().catch((err) => alert(err.message || String(err)));
    });

    els.keywordInput.addEventListener("keydown", (evt) => {
      if (evt.key !== "Enter") {
        return;
      }
      state.keyword = els.keywordInput.value.trim();
      state.page = 1;
      loadMetaAndRows().catch((err) => alert(err.message || String(err)));
    });

    els.dateFromInput.addEventListener("change", () => {
      state.page = 1;
      loadMetaAndRows().catch((err) => alert(err.message || String(err)));
    });

    els.dateToInput.addEventListener("change", () => {
      state.page = 1;
      loadMetaAndRows().catch((err) => alert(err.message || String(err)));
    });

    els.resetBtn.addEventListener("click", () => {
      const latest = state.salesDates[0] || "";
      state.dateFrom = latest;
      state.dateTo = latest;
      state.keyword = "";
      state.page = 1;
      els.keywordInput.value = "";
      applyRangeToInputs();
      loadMetaAndRows().catch((err) => alert(err.message || String(err)));
    });

    els.pageSizeSelect.addEventListener("change", () => {
      state.pageSize = Number(els.pageSizeSelect.value) || 50;
      state.page = 1;
      loadMetaAndRows().catch((err) => alert(err.message || String(err)));
    });

    els.prevBtn.addEventListener("click", () => {
      if (state.page <= 1) {
        return;
      }
      state.page -= 1;
      loadMetaAndRows().catch((err) => alert(err.message || String(err)));
    });

    els.nextBtn.addEventListener("click", () => {
      const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
      if (state.page >= totalPages) {
        return;
      }
      state.page += 1;
      loadMetaAndRows().catch((err) => alert(err.message || String(err)));
    });

    els.exportBtn.addEventListener("click", () => {
      normalizeRangeFromInputs();
      if (!state.dateFrom || !state.dateTo) {
        return;
      }
      const fromQ = encodeURIComponent(state.dateFrom);
      const toQ = encodeURIComponent(state.dateTo);
      window.open(`/api/report-daily/export.xlsb?dateFrom=${fromQ}&dateTo=${toQ}`, "_blank");
    });
  }

  async function init() {
    setLoading(true);
    try {
      await loadDates();
      bindEvents();
      await loadMetaAndRows();
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  init();
})();
