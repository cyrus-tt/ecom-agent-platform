import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import ConversationSidebar from "../components/ConversationSidebar";
import ReportDrawer from "../components/ReportDrawer";
import useConversations from "../hooks/useConversations";

const ReportPreview = lazy(() => import("../components/ReportPreview"));

const QUICK_PROMPTS = [
  { icon: "chart", label: "本周销额复盘", prompt: "帮我分析一下本周销额变化的原因，对比上一周。" },
  { icon: "target", label: "品类结构分析", prompt: "分析最近一周各品类的销售结构，找出贡献最高和下滑最大的品类。" },
  { icon: "alert", label: "销售异常归因", prompt: "最近三天销售有没有异常波动？请定位可能的异常点和原因。" },
  { icon: "event", label: "近期活动效果", prompt: "帮我看最近一次大促活动的表现：GMV、流量、转化、ROI。" },
];

const REPORT_TEMPLATES = [
  { icon: "📊", label: "日报 · 渠道销售汇总", prompt: "生成今天各渠道的销售汇总报表，包含销售额、销量、同比变化，按销售额降序排列。请用 build_report 工具输出可导出的表格。" },
  { icon: "📈", label: "周报 · 品类对比", prompt: "生成本周 vs 上周的品类销售对比报表，包含销售额、销量、同比变化率，按变化率排序。请用 build_report 工具输出可导出的表格。" },
  { icon: "🏪", label: "渠道 Top 20 款", prompt: "生成各主要渠道 Top 20 畅销款的明细报表，包含款号、品类、销售额、销量、折扣率。请用 build_report 工具输出可导出的表格。" },
];

function parseSSEChunk(buffer) {
  const events = [];
  let index = 0;
  while (true) {
    const sep = buffer.indexOf("\n\n", index);
    if (sep === -1) break;
    const block = buffer.slice(index, sep);
    index = sep + 2;
    if (!block.trim()) continue;
    let type = "";
    let data = "";
    for (const rawLine of block.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      if (line.startsWith("event: ")) type = line.slice(7).trim();
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (!data) continue;
    try {
      events.push({ _type: type, ...JSON.parse(data) });
    } catch (_err) {
      // Ignore malformed SSE frames.
    }
  }
  return { events, rest: buffer.slice(index) };
}

function summarizeReport(reportMd) {
  if (!reportMd) return "";
  const clean = String(reportMd)
    .replace(/```(kpi|chart|table)[\s\S]*?```/g, "")
    .replace(/^#+\s.*$/gm, "")
    .replace(/```[\s\S]*?```/g, "")
    .trim();
  const firstParagraph = clean.split(/\n\s*\n/).find((paragraph) => paragraph.trim().length > 0) || "";
  const compact = firstParagraph.replace(/\s+/g, " ").trim();
  if (compact.length <= 240) return compact;
  return `${compact.slice(0, 220).replace(/[,，。；;\s]+\S*$/, "")}...`;
}

function eventToTraceLine(event) {
  const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
  const runId = event.runId || event.run_id || "-";
  if (event._type === "think:start") return { ts, kind: "think", prefix: "think", msg: `round ${event.round || "?"}` };
  if (event._type === "think:content") return { ts, kind: "think", prefix: "think", msg: truncate(event.content, 140) };
  if (event._type === "tool:start") return { ts, kind: "tool", prefix: "tool", msg: `${event.tool || "-"} - ${event.message || "starting"}` };
  if (event._type === "tool:success") return { ts, kind: "success", prefix: "tool", msg: `${event.tool || "-"} (${event.latency_ms || 0}ms)` };
  if (event._type === "tool:failed") return { ts, kind: "error", prefix: "tool", msg: `${event.tool || "-"} - ${event.message || "failed"}` };
  if (event._type === "observe") return { ts, kind: "observe", prefix: "observe", msg: truncate(event.observation, 180) };
  if (event._type === "step:start") return { ts, kind: "system", prefix: "step", msg: event.step || "-" };
  if (event._type === "run:start") return { ts, kind: "system", prefix: "run", msg: `started #${runId}` };
  if (event._type === "run:success") return { ts, kind: "success", prefix: "run", msg: `completed #${runId}` };
  if (event._type === "run:failed" || event._type === "run:aborted") {
    return { ts, kind: "error", prefix: "run", msg: event.message || event._type };
  }
  return null;
}

function truncate(text, length) {
  const value = String(text || "");
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function statusLineFromEvent(event) {
  if (event._type === "think:start") return "正在思考...";
  if (event._type === "tool:start") return `正在调用工具：${event.tool}`;
  if (event._type === "tool:success") return `工具返回：${event.tool}`;
  if (event._type === "observe") return "正在观察结果...";
  if (event._type === "step:start") return `开始第 ${event.round || "?"} 轮推理`;
  return null;
}

export default function AnalysisPage() {
  const {
    conversations,
    activeId,
    activeConversation,
    setActiveId,
    createConversation,
    deleteConversation,
    renameConversation,
    updateConversation,
  } = useConversations();

  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [drawerReportId, setDrawerReportId] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const abortRef = useRef(null);
  const threadRef = useRef(null);
  const inputRef = useRef(null);

  const messages = activeConversation?.messages || [];

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [activeId]);

  const sendQuestion = useCallback(
    async (questionText) => {
      const question = String(questionText || "").trim();
      if (!question || running) return;

      const userMessage = { id: `u-${Date.now()}`, role: "user", content: question };
      const agentMessage = {
        id: `a-${Date.now()}`,
        role: "agent",
        status: "running",
        statusLine: "正在启动分析...",
        trace: [],
        summary: "",
        reportId: null,
        reportSchema: null,
        errorMessage: "",
      };

      let conversationId = activeId;
      if (!conversationId) {
        conversationId = createConversation(userMessage);
        updateConversation(conversationId, (items) => [...items, agentMessage]);
      } else {
        updateConversation(conversationId, (items) => [...items, userMessage, agentMessage]);
      }

      setInput("");
      setRunning(true);

      const abortController = new AbortController();
      abortRef.current = abortController;

      const patchAgent = (patcher) => {
        updateConversation(conversationId, (items) => {
          const copy = items.slice();
          const index = copy.findIndex((item) => item.id === agentMessage.id);
          if (index === -1) return items;
          copy[index] = { ...copy[index], ...patcher(copy[index]) };
          return copy;
        });
      };

      try {
        const response = await fetch("/api/agent/react/stream", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
          signal: abortController.signal,
        });

        if (!response.ok || !response.body) {
          const body = await response.text().catch(() => "");
          throw new Error(`HTTP ${response.status} ${body.slice(0, 200)}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finalReportMd = "";
        let finalReportId = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = parseSSEChunk(buffer);
          buffer = rest;

          for (const event of events) {
            const line = eventToTraceLine(event);
            const statusLine = statusLineFromEvent(event);
            patchAgent((message) => ({
              trace: line ? [...message.trace, line] : message.trace,
              statusLine: statusLine ?? message.statusLine,
            }));

            if (event._type === "report_data" && event.data) {
              patchAgent(() => ({ reportSchema: event.data }));
            }
            if (event._type === "think:content" && event.is_final && event.content) {
              finalReportMd = event.content;
            }
            if (event._type === "run:success" || (event._type === "done" && event?.result?.ok)) {
              const payload = event.result || event;
              finalReportMd = payload.report_md || finalReportMd;
              finalReportId = payload.report_id || finalReportId;
            }
            if (event._type === "run:failed" || event._type === "run:aborted") {
              patchAgent(() => ({
                status: "error",
                statusLine: "",
                errorMessage: event.message || "运行失败",
              }));
            }
          }
        }

        if (finalReportMd || finalReportId) {
          patchAgent(() => ({
            status: "success",
            statusLine: "",
            summary: summarizeReport(finalReportMd) || "分析完成，点击查看完整报告。",
            reportId: finalReportId,
          }));
        } else {
          patchAgent((message) =>
            message.status === "error"
              ? {}
              : { status: "error", statusLine: "", errorMessage: "未收到完整响应" }
          );
        }
      } catch (err) {
        if (err.name === "AbortError") {
          patchAgent(() => ({
            status: "error",
            statusLine: "",
            errorMessage: "已取消",
          }));
        } else {
          patchAgent(() => ({
            status: "error",
            statusLine: "",
            errorMessage: err?.message || "请求失败",
          }));
        }
      } finally {
        abortRef.current = null;
        setRunning(false);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    },
    [activeId, running, createConversation, updateConversation]
  );

  const handleSend = useCallback(() => {
    void sendQuestion(input);
  }, [input, sendQuestion]);

  const handleComposerKey = useCallback(
    (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleNewConversation = useCallback(() => {
    if (running && abortRef.current) abortRef.current.abort();
    setActiveId(null);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [running, setActiveId]);

  return (
    <div className={`chat-page chat-theme chat-layout${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}>
      <ConversationSidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={handleNewConversation}
        onDelete={deleteConversation}
        onRename={renameConversation}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
      />

      <div className="chat-main">
        <div className="chat-shell">
          <div className="chat-thread" ref={threadRef}>
            {messages.length === 0 ? <Welcome onPick={(prompt) => void sendQuestion(prompt)} /> : null}
            {messages.map((message) =>
              message.role === "user" ? (
                <UserBubble key={message.id} message={message} />
              ) : (
                <AgentBubble
                  key={message.id}
                  message={message}
                  onOpenReport={() => setDrawerReportId(message.reportId)}
                />
              )
            )}
          </div>
        </div>

        <div className="chat-composer-wrap">
          <div className="chat-composer">
            <textarea
              ref={inputRef}
              className="chat-composer-input"
              placeholder="输入你的经营分析问题...（Enter 发送，Shift+Enter 换行）"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleComposerKey}
              rows={1}
              disabled={running}
            />
            <button
              type="button"
              className="chat-composer-send"
              onClick={handleSend}
              disabled={running || !input.trim()}
              aria-label="发送"
            >
              {running ? "..." : "↑"}
            </button>
          </div>
        </div>
      </div>

      <ReportDrawer reportId={drawerReportId} onClose={() => setDrawerReportId(null)} />
    </div>
  );
}

function Welcome({ onPick }) {
  return (
    <div className="chat-welcome">
      <h1 className="chat-welcome-title">经营分析助手</h1>
      <p className="chat-welcome-sub">告诉我你想看什么：销额复盘、品类归因、异常诊断、活动复盘都可以。</p>
      <div className="chat-quick-grid">
        {QUICK_PROMPTS.map((prompt) => (
          <button key={prompt.label} type="button" className="chat-quick-btn" onClick={() => onPick(prompt.prompt)}>
            <span className="chat-quick-icon">{prompt.icon}</span>
            <span className="chat-quick-label">{prompt.label}</span>
          </button>
        ))}
      </div>
      <h2 className="chat-welcome-section">一键生成报表</h2>
      <div className="chat-quick-grid">
        {REPORT_TEMPLATES.map((template) => (
          <button key={template.label} type="button" className="chat-quick-btn chat-quick-btn-report" onClick={() => onPick(template.prompt)}>
            <span className="chat-quick-icon">{template.icon}</span>
            <span className="chat-quick-label">{template.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function UserBubble({ message }) {
  return (
    <div className="chat-msg chat-msg-user">
      <div className="chat-bubble">{message.content}</div>
    </div>
  );
}

function AgentBubble({ message, onOpenReport }) {
  const [traceOpen, setTraceOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);
  const running = message.status === "running";
  const hasReport = Boolean(message.reportId);
  const hasReportSchema = Boolean(message.reportSchema);

  return (
    <div className="chat-msg chat-msg-agent">
      <div className="chat-bubble">
        {running ? (
          <div className="chat-status-line">
            <span className="chat-status-spinner" />
            <span>{message.statusLine || "正在分析..."}</span>
          </div>
        ) : null}

        {message.status === "success" ? <div>{message.summary}</div> : null}

        {message.status === "error" ? (
          <div style={{ color: "#b23a2b" }}>运行失败：{message.errorMessage || "未知错误"}</div>
        ) : null}

        {hasReportSchema && previewOpen ? (
          <Suspense fallback={<div className="chat-status-line">加载预览组件...</div>}>
            <ReportPreview reportSchema={message.reportSchema} onClose={() => setPreviewOpen(false)} />
          </Suspense>
        ) : null}

        {hasReport || hasReportSchema || (!running && message.trace?.length > 0) ? (
          <div className="chat-bubble-footer">
            {hasReport ? (
              <button type="button" className="chat-action-btn" onClick={onOpenReport}>
                查看完整报告
              </button>
            ) : null}
            {hasReportSchema && !previewOpen ? (
              <button type="button" className="chat-action-btn" onClick={() => setPreviewOpen(true)}>
                显示报表预览
              </button>
            ) : null}
            {message.trace?.length > 0 ? (
              <button
                type="button"
                className="chat-action-btn is-secondary"
                onClick={() => setTraceOpen((value) => !value)}
              >
                {traceOpen ? "收起" : "展开"}调用过程（{message.trace.length}）
              </button>
            ) : null}
          </div>
        ) : null}

        {traceOpen && message.trace?.length > 0 ? (
          <div className="chat-trace">
            <div className="chat-trace-body">
              {message.trace.map((line, index) => (
                <div key={index} className="chat-trace-line">
                  <span className="chat-trace-ts">{line.ts}</span>
                  <span className={`chat-trace-prefix kind-${line.kind}`}>{line.prefix}</span>
                  <span className="chat-trace-msg">{line.msg}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
