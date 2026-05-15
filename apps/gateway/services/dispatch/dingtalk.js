"use strict";

const crypto = require("crypto");
const https = require("https");
const http = require("http");
const { URL } = require("url");

function getWebhookUrl() {
  return String(process.env.DISPATCH_DINGTALK_WEBHOOK_URL || "").trim();
}

function getSecret() {
  return String(process.env.DISPATCH_DINGTALK_SECRET || "").trim();
}

function getSignedUrl() {
  const base = getWebhookUrl();
  if (!base) return "";
  const secret = getSecret();
  if (!secret) return base;
  const ts = Date.now();
  const signStr = `${ts}\n${secret}`;
  const sign = crypto.createHmac("sha256", secret).update(signStr).digest("base64");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}timestamp=${ts}&sign=${encodeURIComponent(sign)}`;
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); }
        } else {
          reject(new Error(`DingTalk ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("dingtalk timeout")));
    req.write(body);
    req.end();
  });
}

async function sendMarkdown(title, content) {
  const url = getSignedUrl();
  if (!url) return { skipped: true, reason: "webhook_not_configured" };
  const body = JSON.stringify({
    msgtype: "markdown",
    markdown: { title, text: content },
  });
  try {
    await postJson(url, body);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

async function sendConfirmRequest(taskTitle, issues, confirmUrl) {
  const lines = [`### 【调拨确认】${taskTitle}`, ""];
  lines.push(`以下 **${issues.length}** 项需确认：`, "");
  issues.forEach((issue, i) => {
    lines.push(`${i + 1}. ${issue.description}`);
    if (issue.options) {
      issue.options.forEach((opt, j) => {
        lines.push(`   - 选项${j + 1}: ${opt}`);
      });
    }
  });
  lines.push("");
  lines.push(`> [点击打开确认页面](${confirmUrl})`);
  return sendMarkdown(`调拨确认-${taskTitle}`, lines.join("\n"));
}

module.exports = {
  sendMarkdown,
  sendConfirmRequest,
  getWebhookUrl,
};
