import { useEffect, useRef, useState, useCallback } from "react";
import { Button, Space, Spin, message } from "antd";
import { DownloadOutlined, CloseOutlined } from "@ant-design/icons";
import http from "../api/http";

/* ------------------------------------------------------------------ */
/*  ReportPreview — Univer 电子表格预览组件                            */
/*  接收 reportSchema（Report Schema JSON），渲染可交互的表格预览       */
/*  导出功能走后端 /api/report/export（ExcelJS 生成 xlsx）              */
/*  本组件应通过 React.lazy 懒加载，Univer 体积较大                     */
/* ------------------------------------------------------------------ */

/**
 * 将 reportSchema 中单个 sheet 的 column type 映射为 Univer numfmt pattern
 */
function numfmtPattern(type) {
  switch (type) {
    case "currency":
      return "¥#,##0.00";
    case "percent":
      return "0.0%";
    case "number":
      return "#,##0";
    default:
      return null;
  }
}

/**
 * 把 Report Schema 转为 Univer IWorkbookData 格式
 */
function schemaToWorkbookData(reportSchema) {
  // 延迟读取枚举值，因为 @univerjs/core 可能在 SSR 环境下未加载
  // 这里用数字常量，对应 @univerjs/core 的枚举定义
  const BOLD = 1; // BooleanNumber.TRUE
  const H_CENTER = 2; // HorizontalAlign.CENTER
  const H_LEFT = 1; // HorizontalAlign.LEFT
  const V_MIDDLE = 2; // VerticalAlign.MIDDLE
  const WRAP = 2; // WrapStrategy.WRAP
  const CELL_NUMBER = 2; // CellValueType.NUMBER

  const sheets = {};
  const sheetOrder = [];
  const styles = {};
  let styleIdx = 0;

  // 标题行样式
  const titleStyleId = `s_${styleIdx++}`;
  styles[titleStyleId] = {
    bl: BOLD,
    fs: 14,
    cl: { rgb: "#FFFFFF" },
    bg: { rgb: "#102a62" },
    ht: H_CENTER,
    vt: V_MIDDLE,
  };

  // 表头行样式
  const headerStyleId = `s_${styleIdx++}`;
  styles[headerStyleId] = {
    bl: BOLD,
    fs: 11,
    cl: { rgb: "#FFFFFF" },
    bg: { rgb: "#165dff" },
    ht: H_CENTER,
    vt: V_MIDDLE,
  };

  // 正值（绿色）
  const positiveStyleId = `s_${styleIdx++}`;
  styles[positiveStyleId] = {
    cl: { rgb: "#2b7a3f" },
    bl: BOLD,
    ht: H_CENTER,
    vt: V_MIDDLE,
  };

  // 负值（红色）
  const negativeStyleId = `s_${styleIdx++}`;
  styles[negativeStyleId] = {
    cl: { rgb: "#cf1322" },
    bl: BOLD,
    ht: H_CENTER,
    vt: V_MIDDLE,
  };

  // 普通数据居中样式
  const dataCenterStyleId = `s_${styleIdx++}`;
  styles[dataCenterStyleId] = {
    ht: H_CENTER,
    vt: V_MIDDLE,
  };

  // 普通数据左对齐样式
  const dataLeftStyleId = `s_${styleIdx++}`;
  styles[dataLeftStyleId] = {
    ht: H_LEFT,
    vt: V_MIDDLE,
  };

  const schemaSheets = Array.isArray(reportSchema?.sheets) ? reportSchema.sheets : [];

  schemaSheets.forEach((sheetDef, sheetIndex) => {
    const sheetId = `sheet_${sheetIndex}`;
    sheetOrder.push(sheetId);

    const columns = Array.isArray(sheetDef.columns) ? sheetDef.columns : [];
    let data = Array.isArray(sheetDef.data) ? [...sheetDef.data] : [];
    const opts = sheetDef.options || {};
    const colCount = columns.length || 1;

    // 排序
    if (opts.sortBy && opts.sortBy.key) {
      const sortKey = opts.sortBy.key;
      const desc = opts.sortBy.order === "desc";
      data.sort((a, b) => {
        const va = a?.[sortKey] ?? 0;
        const vb = b?.[sortKey] ?? 0;
        if (typeof va === "number" && typeof vb === "number") {
          return desc ? vb - va : va - vb;
        }
        return desc
          ? String(vb).localeCompare(String(va))
          : String(va).localeCompare(String(vb));
      });
    }

    const cellData = {};

    // Row 0: 标题（合并）
    const title = reportSchema?.title || sheetDef.name || "报表预览";
    cellData[0] = {
      0: { v: title, s: titleStyleId },
    };

    // Row 1: 表头
    cellData[1] = {};
    columns.forEach((col, ci) => {
      cellData[1][ci] = { v: col.header || col.key || "", s: headerStyleId };
    });

    // Row 2+: 数据
    data.forEach((row, ri) => {
      const rowIdx = ri + 2;
      cellData[rowIdx] = {};
      columns.forEach((col, ci) => {
        const rawVal = row?.[col.key];
        const cell = {};

        if (rawVal == null) {
          cell.v = "";
          cell.s = dataCenterStyleId;
        } else if (col.type === "text") {
          cell.v = String(rawVal);
          cell.s = dataLeftStyleId;
        } else {
          cell.v = Number(rawVal) || 0;
          cell.t = CELL_NUMBER;

          // 条件格式：正负色
          if (col.conditional && typeof rawVal === "number") {
            if (rawVal > 0 && col.conditional.positive === "green") {
              // 为正值百分比创建带 numfmt 的样式
              const pStyleId = `s_${styleIdx++}`;
              const pattern = numfmtPattern(col.type);
              styles[pStyleId] = {
                ...styles[positiveStyleId],
                ...(pattern ? { n: { pattern } } : {}),
              };
              cell.s = pStyleId;
            } else if (rawVal < 0 && col.conditional.negative === "red") {
              const nStyleId = `s_${styleIdx++}`;
              const pattern = numfmtPattern(col.type);
              styles[nStyleId] = {
                ...styles[negativeStyleId],
                ...(pattern ? { n: { pattern } } : {}),
              };
              cell.s = nStyleId;
            } else {
              // 零值或其他
              const zStyleId = `s_${styleIdx++}`;
              const pattern = numfmtPattern(col.type);
              styles[zStyleId] = {
                ...styles[dataCenterStyleId],
                ...(pattern ? { n: { pattern } } : {}),
              };
              cell.s = zStyleId;
            }
          } else {
            // 无条件格式，仅应用 numfmt
            const pattern = numfmtPattern(col.type);
            if (pattern) {
              const fmtStyleId = `s_${styleIdx++}`;
              styles[fmtStyleId] = {
                ...styles[dataCenterStyleId],
                n: { pattern },
              };
              cell.s = fmtStyleId;
            } else {
              cell.s = dataCenterStyleId;
            }
          }
        }

        cellData[rowIdx][ci] = cell;
      });
    });

    // columnData: 列宽
    const columnData = {};
    columns.forEach((col, ci) => {
      // Univer 用像素，Excel 的 "字符宽度" 大约 * 8
      const charWidth = col.width || 12;
      columnData[ci] = { w: charWidth * 8 };
    });

    // freeze panes
    const freezeRow = opts.freezeRow || 0;
    // 冻结标题行 + 表头行 = row 0 (title) + row 1 (header) = freeze after row 2
    const freezeAfter = freezeRow > 0 ? freezeRow + 1 : 0; // +1 因为 row 0 是标题

    // merge title row across all columns
    const mergeData =
      colCount > 1
        ? [
            {
              startRow: 0,
              endRow: 0,
              startColumn: 0,
              endColumn: colCount - 1,
            },
          ]
        : [];

    sheets[sheetId] = {
      id: sheetId,
      name: sheetDef.name || `Sheet${sheetIndex + 1}`,
      tabColor: "",
      hidden: 0, // BooleanNumber.FALSE
      rowCount: data.length + 10, // 多留一些空行
      columnCount: Math.max(colCount, 5),
      defaultColumnWidth: 96,
      defaultRowHeight: 28,
      cellData,
      columnData,
      rowData: {
        0: { h: 40 }, // 标题行高一点
        1: { h: 32 }, // 表头行
      },
      mergeData,
      freeze: freezeAfter > 0
        ? { xSplit: 0, ySplit: freezeAfter, startRow: freezeAfter, startColumn: 0 }
        : { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 },
      showGridlines: 1, // BooleanNumber.TRUE
      rowHeader: { width: 46, hidden: 0 },
      columnHeader: { height: 24, hidden: 0 },
      rightToLeft: 0, // BooleanNumber.FALSE
      zoomRatio: 1,
      scrollTop: 0,
      scrollLeft: 0,
    };
  });

  // 如果没有 sheet，生成一个空的
  if (sheetOrder.length === 0) {
    const emptyId = "sheet_empty";
    sheetOrder.push(emptyId);
    sheets[emptyId] = {
      id: emptyId,
      name: "空表",
      tabColor: "",
      hidden: 0,
      rowCount: 20,
      columnCount: 10,
      defaultColumnWidth: 96,
      defaultRowHeight: 28,
      cellData: { 0: { 0: { v: "(无数据)" } } },
      columnData: {},
      rowData: {},
      mergeData: [],
      freeze: { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 },
      showGridlines: 1,
      rowHeader: { width: 46, hidden: 0 },
      columnHeader: { height: 24, hidden: 0 },
      rightToLeft: 0,
      zoomRatio: 1,
      scrollTop: 0,
      scrollLeft: 0,
    };
  }

  return {
    id: "report-preview-workbook",
    name: reportSchema?.title || "报表预览",
    appVersion: "0.22.1",
    locale: "zhCN",
    styles,
    sheetOrder,
    sheets,
  };
}

/**
 * ReportPreview 组件
 * - 接收 reportSchema（Report Schema JSON）
 * - 渲染 Univer 电子表格预览
 * - 提供 Export Excel 和 Close 按钮
 *
 * 本组件应通过 React.lazy() + Suspense 懒加载：
 *   const LazyReportPreview = React.lazy(() => import("./ReportPreview"));
 */
export default function ReportPreview({ reportSchema, onClose }) {
  const containerRef = useRef(null);
  const univerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState(null);
  const [exporting, setExporting] = useState(false);

  /* ---------- 初始化 Univer ---------- */
  useEffect(() => {
    if (!containerRef.current || !reportSchema) return undefined;

    let disposed = false;

    async function init() {
      try {
        // 动态导入 Univer 模块，保持 tree-shaking 友好
        const [coreModule, presetsModule] = await Promise.all([
          import("@univerjs/core"),
          import("@univerjs/presets/preset-sheets-core"),
        ]);
        // CSS
        await import("@univerjs/presets/lib/styles/preset-sheets-core.css");

        if (disposed) return;

        const { Univer, UniverInstanceType, LocaleType } = coreModule;
        const { UniverSheetsCorePreset } = presetsModule;

        // 加载中文 locale
        let zhCNLocale = {};
        try {
          const localeModule = await import(
            "@univerjs/presets/lib/preset-sheets-core/locales/zh-CN.js"
          );
          zhCNLocale = localeModule.default || localeModule;
        } catch (_e) {
          // locale 加载失败不影响主功能
        }

        if (disposed) return;

        const univer = new Univer({
          locale: LocaleType.ZH_CN,
          locales: { [LocaleType.ZH_CN]: zhCNLocale },
        });

        // 注册 preset 插件
        const preset = UniverSheetsCorePreset({
          container: containerRef.current,
          header: false, // 不显示顶部 toolbar（只做预览）
          footer: false,
          toolbar: false,
          formulaBar: false,
        });

        if (preset?.plugins) {
          preset.plugins.forEach((entry) => {
            if (Array.isArray(entry)) {
              univer.registerPlugin(entry[0], entry[1]);
            } else {
              univer.registerPlugin(entry);
            }
          });
        }

        // 转换 schema → workbook data 并创建 unit
        const workbookData = schemaToWorkbookData(reportSchema);
        univer.createUnit(UniverInstanceType.UNIVER_SHEET, workbookData);

        univerRef.current = univer;
        if (!disposed) setReady(true);
      } catch (err) {
        console.error("[ReportPreview] Univer init failed:", err);
        if (!disposed) setInitError(err);
      }
    }

    init();

    return () => {
      disposed = true;
      if (univerRef.current) {
        try {
          univerRef.current.dispose();
        } catch (_e) {
          // ignore dispose errors
        }
        univerRef.current = null;
      }
    };
  }, [reportSchema]);

  /* ---------- 导出 Excel ---------- */
  const handleExport = useCallback(async () => {
    if (!reportSchema) return;
    setExporting(true);
    try {
      const resp = await http.post("/api/report/export", reportSchema, {
        responseType: "blob",
        timeout: 60000,
      });
      // 从 Content-Disposition 获取文件名，兜底用 schema title
      let filename = "report.xlsx";
      const disposition = resp.headers?.["content-disposition"];
      if (disposition) {
        const match = disposition.match(/filename\*?=(?:UTF-8'')?([^;\n]+)/i);
        if (match?.[1]) {
          filename = decodeURIComponent(match[1].replace(/["']/g, ""));
        }
      } else if (reportSchema.title) {
        filename = `${reportSchema.title}.xlsx`;
      }

      const url = URL.createObjectURL(new Blob([resp.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      message.success("导出成功");
    } catch (err) {
      console.error("[ReportPreview] export failed:", err);
      message.error(err?.response?.data?.message || err?.message || "导出失败");
    } finally {
      setExporting(false);
    }
  }, [reportSchema]);

  /* ---------- Univer 加载失败：回退到 Ant Design Table ---------- */
  if (initError) {
    return (
      <FallbackTablePreview
        reportSchema={reportSchema}
        onClose={onClose}
        onExport={handleExport}
        exporting={exporting}
        errorMessage={initError?.message}
      />
    );
  }

  return (
    <div className="report-preview-shell">
      {/* Univer 容器 */}
      <div className="report-preview-container" ref={containerRef}>
        {!ready && (
          <div className="report-preview-loading">
            <Spin tip="加载表格预览..." />
          </div>
        )}
      </div>

      {/* 底部工具栏 */}
      <div className="report-preview-toolbar">
        <Space>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            loading={exporting}
            onClick={handleExport}
          >
            导出 Excel
          </Button>
          {onClose && (
            <Button icon={<CloseOutlined />} onClick={onClose}>
              关闭
            </Button>
          )}
        </Space>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Fallback: Ant Design Table 版预览                                  */
/*  当 Univer 初始化失败时使用（React 18 兼容性/打包问题等）             */
/*  TODO: 如果 Univer 长期不稳定，可以把这个作为主方案                    */
/* ------------------------------------------------------------------ */
import { Table, Tag } from "antd";

function FallbackTablePreview({
  reportSchema,
  onClose,
  onExport,
  exporting,
  errorMessage,
}) {
  const schemaSheets = Array.isArray(reportSchema?.sheets)
    ? reportSchema.sheets
    : [];

  return (
    <div className="report-preview-shell">
      {errorMessage && (
        <div className="report-preview-fallback-notice">
          <Tag color="orange">预览降级</Tag>
          <span>Univer 加载失败，使用简化表格预览。</span>
        </div>
      )}

      {schemaSheets.map((sheetDef, si) => {
        const columns = (sheetDef.columns || []).map((col) => ({
          title: col.header || col.key,
          dataIndex: col.key,
          key: col.key,
          width: col.width ? col.width * 8 : undefined,
          sorter: col.type !== "text"
            ? (a, b) => (Number(a[col.key]) || 0) - (Number(b[col.key]) || 0)
            : undefined,
          render: (val) => {
            if (val == null) return "-";
            if (col.type === "currency") {
              return `¥${Number(val).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }
            if (col.type === "percent") {
              const pct = (Number(val) * 100).toFixed(1);
              const color =
                col.conditional && Number(val) > 0 ? "#2b7a3f" :
                col.conditional && Number(val) < 0 ? "#cf1322" : undefined;
              return <span style={{ color, fontWeight: color ? 600 : undefined }}>{pct}%</span>;
            }
            if (col.type === "number") {
              return Number(val).toLocaleString("zh-CN");
            }
            return String(val);
          },
        }));

        let data = Array.isArray(sheetDef.data) ? [...sheetDef.data] : [];
        const opts = sheetDef.options || {};

        // 默认排序
        if (opts.sortBy?.key) {
          const sortKey = opts.sortBy.key;
          const desc = opts.sortBy.order === "desc";
          data.sort((a, b) => {
            const va = a?.[sortKey] ?? 0;
            const vb = b?.[sortKey] ?? 0;
            return desc ? vb - va : va - vb;
          });
        }

        return (
          <div key={si} style={{ marginBottom: 16 }}>
            <h4 style={{ margin: "0 0 8px", color: "#102a62" }}>
              {reportSchema?.title || sheetDef.name || "报表"}
            </h4>
            <Table
              columns={columns}
              dataSource={data.map((row, idx) => ({ ...row, _key: idx }))}
              rowKey="_key"
              size="small"
              pagination={false}
              bordered
              scroll={{ x: "max-content" }}
              className="app-compact-table"
            />
          </div>
        );
      })}

      {/* 底部工具栏 */}
      <div className="report-preview-toolbar">
        <Space>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            loading={exporting}
            onClick={onExport}
          >
            导出 Excel
          </Button>
          {onClose && (
            <Button icon={<CloseOutlined />} onClick={onClose}>
              关闭
            </Button>
          )}
        </Space>
      </div>
    </div>
  );
}
