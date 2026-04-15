"use strict";

const path = require("path");

const DEFAULT_ARRIVAL_SERVICE_URL = "http://127.0.0.1:5188";
const DEFAULT_NOTES_SERVICE_URL = "http://127.0.0.1:5190";
const DEFAULT_PSQL_BIN_WINDOWS = "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";
const DEFAULT_AGENT_DATA_MODE = "local";

function readEnvText(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) {
      return { value, source: name };
    }
  }
  return { value: "", source: "" };
}

function normalizeServiceUrl(rawValue, fallbackValue) {
  const input = String(rawValue || fallbackValue || "").trim();
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported service url protocol: ${url.protocol}`);
  }
  return url.toString().replace(/\/+$/, "");
}

function resolveServiceUrl(preferredName, legacyNames, fallbackValue) {
  const names = [preferredName, ...(Array.isArray(legacyNames) ? legacyNames : [])];
  const env = readEnvText(...names);
  return {
    value: normalizeServiceUrl(env.value, fallbackValue),
    source: env.source || "default",
  };
}

function resolveOptionalPath(...names) {
  const env = readEnvText(...names);
  if (!env.value) {
    return { value: "", source: "" };
  }
  return {
    value: path.resolve(env.value),
    source: env.source,
  };
}

function resolveAgentDataMode() {
  const env = readEnvText("AGENT_DATA_MODE");
  const mode = String(env.value || DEFAULT_AGENT_DATA_MODE).trim().toLowerCase();
  if (mode === "local" || mode === "remote" || mode === "fixture") {
    return {
      value: mode,
      source: env.source || "default",
    };
  }
  return {
    value: DEFAULT_AGENT_DATA_MODE,
    source: env.source || "default",
  };
}

const arrivalServiceUrl = resolveServiceUrl("ARRIVAL_SERVICE_URL", ["ARRIVAL_BASE"], DEFAULT_ARRIVAL_SERVICE_URL);
const notesServiceUrl = resolveServiceUrl("NOTES_SERVICE_URL", ["NOTES_BASE"], DEFAULT_NOTES_SERVICE_URL);
const arrivalProjectDir = resolveOptionalPath("ARRIVAL_PROJECT_DIR");
const notesProjectDirRaw = resolveOptionalPath("NOTES_PROJECT_DIR");
const notesProjectDir = notesProjectDirRaw.value
  ? notesProjectDirRaw
  : arrivalProjectDir.value
    ? { value: arrivalProjectDir.value, source: "ARRIVAL_PROJECT_DIR" }
    : { value: "", source: "" };
const psqlBin = resolveOptionalPath("PSQL_BIN");
const agentDataMode = resolveAgentDataMode();
const agentRemoteBaseUrl = resolveServiceUrl("AGENT_REMOTE_BASE_URL", [], "http://127.0.0.1:3000");
const agentFixturePath = (() => {
  const explicit = resolveOptionalPath("AGENT_FIXTURE_PATH");
  if (explicit.value) {
    return explicit;
  }
  return {
    value: path.resolve(__dirname, "..", "fixtures", "analysis-context.sample.json"),
    source: "default",
  };
})();
const agentRemoteReadToken = readEnvText("AGENT_REMOTE_READ_TOKEN");
const agentRemoteTimeoutMsRaw = Number(readEnvText("AGENT_REMOTE_TIMEOUT_MS").value || 10000);
const agentRemoteTimeoutMs = Number.isFinite(agentRemoteTimeoutMsRaw) && agentRemoteTimeoutMsRaw > 0
  ? agentRemoteTimeoutMsRaw
  : 10000;

module.exports = {
  DEFAULT_ARRIVAL_SERVICE_URL,
  DEFAULT_NOTES_SERVICE_URL,
  DEFAULT_PSQL_BIN_WINDOWS,
  DEFAULT_AGENT_DATA_MODE,
  arrivalServiceUrl: arrivalServiceUrl.value,
  arrivalServiceUrlSource: arrivalServiceUrl.source,
  notesServiceUrl: notesServiceUrl.value,
  notesServiceUrlSource: notesServiceUrl.source,
  arrivalProjectDir: arrivalProjectDir.value,
  arrivalProjectDirSource: arrivalProjectDir.source || "unset",
  arrivalProjectDirConfigured: Boolean(arrivalProjectDir.value),
  notesProjectDir: notesProjectDir.value,
  notesProjectDirSource: notesProjectDir.source || "unset",
  notesProjectDirConfigured: Boolean(notesProjectDir.value),
  psqlBin: psqlBin.value,
  psqlBinSource: psqlBin.source || "unset",
  agentDataMode: agentDataMode.value,
  agentDataModeSource: agentDataMode.source,
  agentRemoteBaseUrl: agentRemoteBaseUrl.value,
  agentRemoteBaseUrlSource: agentRemoteBaseUrl.source,
  agentFixturePath: agentFixturePath.value,
  agentFixturePathSource: agentFixturePath.source,
  agentRemoteReadToken: agentRemoteReadToken.value,
  agentRemoteReadTokenSource: agentRemoteReadToken.source || "unset",
  agentRemoteTimeoutMs,
};
