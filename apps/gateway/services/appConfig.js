"use strict";

const path = require("path");

const DEFAULT_ARRIVAL_SERVICE_URL = "http://127.0.0.1:5188";
const DEFAULT_NOTES_SERVICE_URL = "http://127.0.0.1:5190";
const DEFAULT_PSQL_BIN_WINDOWS = "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";

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

module.exports = {
  DEFAULT_ARRIVAL_SERVICE_URL,
  DEFAULT_NOTES_SERVICE_URL,
  DEFAULT_PSQL_BIN_WINDOWS,
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
};
