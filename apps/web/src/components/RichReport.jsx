import ReactECharts from "echarts-for-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function parseBlocks(reportMd) {
  if (!reportMd) return [];
  const text = String(reportMd);
  const fence = /```(kpi|chart|table)\s*\n([\s\S]*?)```/g;
  const blocks = [];
  let cursor = 0;
  let match;

  while ((match = fence.exec(text)) !== null) {
    const [full, kind, body] = match;
    if (match.index > cursor) {
      const markdown = text.slice(cursor, match.index);
      if (markdown.trim()) blocks.push({ type: "markdown", text: markdown });
    }
    let payload = null;
    try {
      payload = JSON.parse(body.trim());
    } catch (_err) {
      // Invalid structured block falls back to markdown code.
    }
    blocks.push(payload ? { type: kind, payload } : { type: "markdown", text: `\`\`\`json\n${body}\n\`\`\`` });
    cursor = match.index + full.length;
  }

  if (cursor < text.length) {
    const tail = text.slice(cursor);
    if (tail.trim()) blocks.push({ type: "markdown", text: tail });
  }

  return blocks;
}

const TREND_CLASS = {
  up: "rr-kpi-up",
  down: "rr-kpi-down",
  flat: "rr-kpi-flat",
};

export default function RichReport({ reportMd }) {
  const blocks = parseBlocks(reportMd);
  if (blocks.length === 0) {
    return <div className="chat-drawer-empty">(报告内容为空)</div>;
  }

  return (
    <div className="rr-report">
      {blocks.map((block, index) => {
        if (block.type === "markdown") {
          return (
            <div key={index} className="chat-prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
            </div>
          );
        }
        if (block.type === "kpi") return <KpiBlock key={index} items={block.payload} />;
        if (block.type === "chart") return <ChartBlock key={index} spec={block.payload} />;
        if (block.type === "table") return <TableBlock key={index} spec={block.payload} />;
        return null;
      })}
    </div>
  );
}

function KpiBlock({ items }) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return null;
  return (
    <div className="rr-kpi-row">
      {list.map((item, index) => {
        const trend = String(item?.trend || "flat").toLowerCase();
        const className = TREND_CLASS[trend] || TREND_CLASS.flat;
        return (
          <div key={index} className="rr-kpi-card">
            <div className="rr-kpi-label">{item?.label || "-"}</div>
            <div className="rr-kpi-value">{item?.value ?? "-"}</div>
            {item?.change ? (
              <div className={`rr-kpi-change ${className}`}>
                {trend === "up" ? "up " : trend === "down" ? "down " : ""}
                {item.change}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ChartBlock({ spec }) {
  const option = buildEChartsOption(spec);
  if (!option) {
    return (
      <div className="rr-chart-fallback">
        (图表数据不完整)
        <pre>{JSON.stringify(spec, null, 2)}</pre>
      </div>
    );
  }
  return (
    <div className="rr-chart-card">
      {spec?.title ? <div className="rr-chart-title">{spec.title}</div> : null}
      <ReactECharts option={option} style={{ height: 320, width: "100%" }} notMerge lazyUpdate />
    </div>
  );
}

function buildEChartsOption(spec) {
  if (!spec || typeof spec !== "object") return null;
  const type = String(spec.type || "bar").toLowerCase();
  const palette = ["#c96442", "#d2a165", "#7e5b1f", "#9a5da5", "#2b7a65", "#b23a2b"];

  if (type === "pie") {
    const names = Array.isArray(spec.xAxis) ? spec.xAxis : [];
    const values = spec.series?.[0]?.data || [];
    if (names.length === 0 || values.length === 0) return null;
    return {
      color: palette,
      tooltip: { trigger: "item" },
      legend: { bottom: 4, textStyle: { color: "#6b6558" } },
      series: [
        {
          type: "pie",
          radius: ["42%", "68%"],
          avoidLabelOverlap: true,
          label: { color: "#2c2a26" },
          data: names.map((name, index) => ({ name, value: Number(values[index]) || 0 })),
        },
      ],
    };
  }

  const xData = Array.isArray(spec.xAxis) ? spec.xAxis : [];
  const seriesInput = Array.isArray(spec.series) ? spec.series : [];
  if (xData.length === 0 || seriesInput.length === 0) return null;

  return {
    color: palette,
    tooltip: { trigger: "axis" },
    legend: seriesInput.length > 1 ? { top: 4, textStyle: { color: "#6b6558" } } : undefined,
    grid: { left: 48, right: 24, top: seriesInput.length > 1 ? 36 : 16, bottom: 32 },
    xAxis: {
      type: "category",
      data: xData,
      axisLabel: { color: "#6b6558" },
      axisLine: { lineStyle: { color: "#d8cba8" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#6b6558" },
      splitLine: { lineStyle: { color: "#ede6d3" } },
    },
    series: seriesInput.map((item) => ({
      name: item.name || "",
      type: type === "line" ? "line" : "bar",
      data: Array.isArray(item.data) ? item.data.map((value) => (value == null ? 0 : Number(value))) : [],
      smooth: type === "line" ? true : undefined,
      barMaxWidth: type === "bar" ? 36 : undefined,
    })),
  };
}

function TableBlock({ spec }) {
  const columns = Array.isArray(spec?.columns) ? spec.columns : [];
  const rows = Array.isArray(spec?.rows) ? spec.rows : [];
  if (columns.length === 0 || rows.length === 0) {
    return <div className="rr-table-fallback">(数据表为空)</div>;
  }
  return (
    <div className="rr-table-card">
      {spec?.title ? <div className="rr-table-title">{spec.title}</div> : null}
      <div className="rr-table-wrap">
        <table className="rr-table">
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th key={index}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {(Array.isArray(row) ? row : []).map((cell, cellIndex) => (
                  <td key={cellIndex}>{formatCell(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatCell(value) {
  if (value == null) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
