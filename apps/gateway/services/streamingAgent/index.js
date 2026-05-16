"use strict";

const { OpenAI } = require("openai");
const reportRepo = require("../reportRepo");
const runtimeSecrets = require("../runtimeSecrets");
const traceRepo = require("./traceRepo");
const tools = require("./tools");

const MAX_ROUNDS = 5;
const MAX_OBSERVATION_CHARS = 1800;

function createClient() {
  const apiKey = runtimeSecrets.getDeepseekApiKey();
  if (!apiKey) {
    const err = new Error("DEEPSEEK_API_KEY 未配置，无法启动流式分析 Agent。");
    err.code = "AI_NOT_CONFIGURED";
    throw err;
  }
  return {
    model: String(process.env.DEEPSEEK_MODEL || runtimeSecrets.DEFAULT_DEEPSEEK_MODEL),
    client: new OpenAI({
      apiKey,
      baseURL: String(process.env.DEEPSEEK_BASE_URL || runtimeSecrets.DEFAULT_DEEPSEEK_BASE_URL),
    }),
  };
}

function buildSystemPrompt() {
  return [
    "你是安踏电商经营流式数据分析 Agent。",
    "你必须通过工具读取数据后再回答，不能编造任何精确数字。",
    "所有工具只返回聚合数据；不得要求或输出 SKU、款号、品名等明细字段。",
    "如果当前工具无法验证某个维度，必须明确写“无法从现有聚合数据验证”。",
    "",
    "输出要求：",
    "1. 先给一句话结论。",
    "2. 给 3-6 个关键指标，必须引用工具返回的数字。",
    "3. 给主要变化或结构解释。",
    "4. 给可执行建议，动作限定为补货、调拨、下架、加推、降推、改价。",
    "5. 用 Markdown 输出，必要时使用表格。",
  ].join("\n");
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text || "{}");
  } catch (_err) {
    return {};
  }
}

function normalizeFinalContent(message) {
  const content = message?.content;
  if (Array.isArray(content)) {
    return content.map((item) => item?.text || "").join("\n").trim();
  }
  return String(content || "").trim();
}

function inferRole(user) {
  if (user?.is_admin === true) return "admin";
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  return permissions.includes("analysis") ? "analyst" : "viewer";
}

function getDisplayName(user) {
  return String(user?.name || user?.username || "anonymous").trim() || "anonymous";
}

async function saveFinalReport({ question, finalReport, toolResults }) {
  const datePayload = toolResults.find((item) => item.tool === "get_available_dates")?.data || {};
  const periodPayload = toolResults.find((item) => item.data?.period)?.data?.period || {};
  const today = new Date().toISOString().slice(0, 10);
  const periodStart = String(periodPayload.start || datePayload.default_date_from || datePayload.default_anchor_date || today);
  const periodEnd = String(periodPayload.end || datePayload.default_date_to || datePayload.default_anchor_date || today);
  const saved = await reportRepo.createAnalysisReport({
    periodType: "stream",
    periodStart,
    periodEnd,
    skillId: "streaming_react",
    skillName: "流式问数 Agent",
    promptText: question,
    metricsJson: {
      tool_count: toolResults.length,
      tools: toolResults.map((item) => item.tool),
    },
    reportMd: finalReport,
    status: "success",
    errorMsg: "",
  });
  return saved;
}

async function* executeReactStream({ question, user }, ctx = {}) {
  const trimmedQuestion = String(question || "").trim();
  if (!trimmedQuestion) {
    throw new Error("question is required");
  }

  const requestedBy = getDisplayName(user);
  const role = inferRole(user);
  const run = await traceRepo.createRun({
    taskName: "streaming-react-analysis",
    requestedBy,
    inputSnapshot: { question: trimmedQuestion, role },
  });
  const runId = run?.id || null;
  let modelName = "";
  const toolResults = [];

  yield { type: "run:start", run_id: runId, task_name: "streaming-react-analysis", requested_by: requestedBy };

  try {
    const llm = createClient();
    modelName = llm.model;
    const messages = [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: trimmedQuestion },
    ];
    let finalReport = "";

    for (let round = 1; round <= MAX_ROUNDS; round += 1) {
      ctx.signal?.throwIfAborted?.();
      const step = await traceRepo.createStep(runId, { stepName: `react_round_${round}`, stepOrder: round });
      yield { type: "think:start", run_id: runId, round, message: "分析问题并选择数据工具" };

      const completion = await llm.client.chat.completions.create(
        {
          model: llm.model,
          temperature: 0.2,
          max_tokens: 3600,
          messages,
          tools: tools.getOpenAITools(),
          tool_choice: "auto",
        },
        { timeout: 60000, signal: ctx.signal }
      );
      modelName = completion?.model || llm.model;
      const message = completion?.choices?.[0]?.message;
      if (!message) {
        throw new Error("AI 返回空消息。");
      }

      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (toolCalls.length === 0) {
        finalReport = normalizeFinalContent(message);
        await traceRepo.updateStep(step?.id, { status: "success" });
        yield { type: "think:content", run_id: runId, round, content: finalReport, is_final: true };
        break;
      }

      messages.push({
        role: "assistant",
        content: message.content || null,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        ctx.signal?.throwIfAborted?.();
        const toolName = call?.function?.name;
        const toolInput = safeJsonParse(call?.function?.arguments);
        const startedAt = Date.now();
        yield { type: "tool:start", run_id: runId, round, tool: toolName, input: toolInput };

        let toolResult;
        try {
          toolResult = await tools.callTool(toolName, toolInput);
          const latencyMs = Date.now() - startedAt;
          toolResults.push({ tool: toolName, data: toolResult });
          await traceRepo.recordToolCall(runId, step?.id, {
            toolName,
            inputJson: toolInput,
            outputJson: { aggregate_only: true, preview: tools.summarizeForObservation(toolResult, 500) },
            status: "success",
            latencyMs,
          });
          const observation = tools.summarizeForObservation(toolResult, MAX_OBSERVATION_CHARS);
          yield { type: "tool:success", run_id: runId, round, tool: toolName, latency_ms: latencyMs };
          yield { type: "observe", run_id: runId, round, tool: toolName, observation };
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: observation,
          });
        } catch (err) {
          const latencyMs = Date.now() - startedAt;
          await traceRepo.recordToolCall(runId, step?.id, {
            toolName,
            inputJson: toolInput,
            outputJson: { error: err.message || String(err) },
            status: "failed",
            latencyMs,
          });
          yield {
            type: "tool:failed",
            run_id: runId,
            round,
            tool: toolName,
            message: err.message || String(err),
            latency_ms: latencyMs,
          };
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: `工具调用失败：${err.message || String(err)}`,
          });
        }
      }

      await traceRepo.updateStep(step?.id, { status: "success" });
      if (round === MAX_ROUNDS) {
        messages.push({
          role: "user",
          content: "请基于已经获得的工具结果立即输出最终报告，不要继续调用工具。",
        });
      }
    }

    if (!finalReport) {
      const completion = await llm.client.chat.completions.create(
        {
          model: llm.model,
          temperature: 0.2,
          max_tokens: 2400,
          messages: [
            ...messages,
            { role: "user", content: "请基于当前工具结果输出最终经营分析报告。" },
          ],
        },
        { timeout: 60000, signal: ctx.signal }
      );
      finalReport = normalizeFinalContent(completion?.choices?.[0]?.message);
      modelName = completion?.model || modelName;
      yield { type: "think:content", run_id: runId, content: finalReport, is_final: true };
    }

    const saved = await saveFinalReport({ question: trimmedQuestion, finalReport, toolResults });
    await traceRepo.createArtifact(runId, { artifactType: "report_md", contentJson: { report_md: finalReport } });
    await traceRepo.createArtifact(runId, {
      artifactType: "tool_summary",
      contentJson: { tools: toolResults.map((item) => item.tool) },
    });
    await traceRepo.updateRun(runId, { status: "success", modelName });

    const result = {
      ok: true,
      run_id: runId,
      report_id: Number(saved?.id || 0),
      report_md: finalReport,
      skill_id: "streaming_react",
      skill_name: "流式问数 Agent",
      prompt_text: trimmedQuestion,
      created_at: saved?.created_at ? new Date(saved.created_at).toISOString() : new Date().toISOString(),
      model: modelName,
      tool_count: toolResults.length,
    };
    yield { type: "run:success", run_id: runId, result };
    return result;
  } catch (err) {
    const isAbort = err?.name === "AbortError" || err?.code === "ABORT_ERR";
    await traceRepo.updateRun(runId, {
      status: isAbort ? "aborted" : "failed",
      modelName,
      errorCode: err.code || (isAbort ? "ABORTED" : "UNKNOWN_ERROR"),
      errorMessage: err.message || String(err),
    }).catch(() => {});
    yield {
      type: isAbort ? "run:aborted" : "run:failed",
      run_id: runId,
      code: err.code || (isAbort ? "ABORTED" : "UNKNOWN_ERROR"),
      message: err.message || String(err),
    };
    return {
      ok: false,
      run_id: runId,
      error_code: err.code || "UNKNOWN_ERROR",
      message: err.message || String(err),
    };
  }
}

module.exports = {
  MAX_ROUNDS,
  executeReactStream,
  listTools: tools.listTools,
  listRuns: traceRepo.listRuns,
  getRunDetail: traceRepo.getRunDetail,
};
