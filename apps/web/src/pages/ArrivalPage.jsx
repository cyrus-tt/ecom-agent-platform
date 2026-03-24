import {
  AppstoreOutlined,
  FileSearchOutlined,
  PushpinOutlined,
  ReloadOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Modal,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import http from "../api/http";
import SkuPreview from "../components/SkuPreview";
import {
  compareText,
  computeSummary,
  DEFAULT_DRILL_MODE,
  DRILL_MODE_OPTIONS,
  EMPTY_LABEL,
  formatNoteSummary,
  formatNumber,
  formatPercent,
  getDrillLevels,
  getFieldValue,
  getStoredValue,
  groupRecords,
  hasNoteContent,
  normalizeNote,
  normalizeToken,
  NOTES_USER_STORAGE_KEY,
  parseSearchTokens,
  sanitizeApiBase,
  setStoredValue,
  toNumber,
  toText,
} from "../utils/arrival";

const { Title, Text } = Typography;

function buildArrivalRateNode(value) {
  const percent = Math.round(Math.max(0, Math.min(1, toNumber(value))) * 1000) / 10;
  const status = percent >= 100 ? "success" : percent > 0 ? "active" : "normal";
  return (
    <div className="arrival-rate-cell">
      <Text>{percent.toFixed(1)}%</Text>
      <Progress percent={percent} size="small" status={status} showInfo={false} />
    </div>
  );
}

function normalizeNoteUsers(items, fallbackUser = "") {
  const seen = new Set();
  const users = [];
  (Array.isArray(items) ? items : []).forEach((item) => {
    const name = toText(item?.name || item?.label || item?.value);
    if (!name || seen.has(name)) {
      return;
    }
    seen.add(name);
    users.push({
      key: toText(item?.account_id || item?.id || name),
      value: name,
      label: name,
      isPrimaryAdmin: item?.is_primary_admin === true,
    });
  });
  const nextFallbackUser = toText(fallbackUser);
  if (nextFallbackUser && !seen.has(nextFallbackUser)) {
    users.unshift({
      key: nextFallbackUser,
      value: nextFallbackUser,
      label: nextFallbackUser,
      isPrimaryAdmin: false,
    });
  }
  return users;
}

function buildNoteUserOptions(users) {
  const seen = new Set();
  const options = [];
  (Array.isArray(users) ? users : []).forEach((item) => {
    const value = toText(item?.value);
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    options.push(item);
  });
  return options;
}

function pickPreferredNoteUser(users, ...candidates) {
  const values = buildNoteUserOptions(users).map((item) => item.value);
  const valueSet = new Set(values);
  const normalized = candidates.map(toText).filter(Boolean);
  if (!values.length) {
    return normalized[0] || "";
  }
  for (const candidate of normalized) {
    if (valueSet.has(candidate)) {
      return candidate;
    }
  }
  return values[0] || "";
}

function sortMemoRows(left, right) {
  const leftTime = Date.parse(toText(left?.note?.updated_at));
  const rightTime = Date.parse(toText(right?.note?.updated_at));
  if (!Number.isNaN(leftTime) || !Number.isNaN(rightTime)) {
    if (Number.isNaN(leftTime)) {
      return 1;
    }
    if (Number.isNaN(rightTime)) {
      return -1;
    }
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }
  }
  return compareText(left?.sku, right?.sku);
}

const ARRIVAL_OVERVIEW_FILTER_FIELDS = [
  { key: "major_category", label: "\u5927\u7c7b", placeholder: "\u9009\u62e9\u5927\u7c7b" },
  { key: "gender", label: "\u6027\u522b", placeholder: "\u9009\u62e9\u6027\u522b" },
  { key: "season", label: "\u4ea7\u54c1\u5b63", placeholder: "\u9009\u62e9\u4ea7\u54c1\u5b63" },
  { key: "category", label: "\u4e2d\u7c7b", placeholder: "\u9009\u62e9\u4e2d\u7c7b" },
];

function createEmptyOverviewFilters() {
  return ARRIVAL_OVERVIEW_FILTER_FIELDS.reduce((result, item) => {
    result[item.key] = [];
    return result;
  }, {});
}

function normalizeOverviewFilterValues(values) {
  const seen = new Set();
  const nextValues = [];
  (Array.isArray(values) ? values : []).forEach((item) => {
    const value = toText(item);
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    nextValues.push(value);
  });
  return nextValues;
}

function normalizeOverviewFilters(filters, validValuesByKey = null) {
  const nextFilters = createEmptyOverviewFilters();
  ARRIVAL_OVERVIEW_FILTER_FIELDS.forEach(({ key }) => {
    const validValues = Array.isArray(validValuesByKey?.[key]) ? new Set(validValuesByKey[key]) : null;
    normalizeOverviewFilterValues(filters?.[key]).forEach((value) => {
      if (!validValues || validValues.has(value)) {
        nextFilters[key].push(value);
      }
    });
  });
  return nextFilters;
}

function areOverviewFiltersEqual(left, right) {
  return ARRIVAL_OVERVIEW_FILTER_FIELDS.every(({ key }) => {
    const leftValues = Array.isArray(left?.[key]) ? left[key] : [];
    const rightValues = Array.isArray(right?.[key]) ? right[key] : [];
    return (
      leftValues.length === rightValues.length &&
      leftValues.every((value, index) => value === rightValues[index])
    );
  });
}

function hasOverviewFilters(filters) {
  return ARRIVAL_OVERVIEW_FILTER_FIELDS.some(({ key }) => Array.isArray(filters?.[key]) && filters[key].length > 0);
}

function recordMatchesOverviewFilters(record, filters) {
  return ARRIVAL_OVERVIEW_FILTER_FIELDS.every(({ key }) => {
    const selectedValues = Array.isArray(filters?.[key]) ? filters[key] : [];
    return !selectedValues.length || selectedValues.includes(getFieldValue(record, key));
  });
}

export default function ArrivalPage() {
  const notesRequestIdRef = useRef(0);
  const [statusData, setStatusData] = useState(null);
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusBanner, setStatusBanner] = useState({ type: "info", text: "正在加载新品入库看板..." });
  const [drillMode, setDrillMode] = useState(DEFAULT_DRILL_MODE);
  const [drillPath, setDrillPath] = useState([]);
  const [draftOverviewFilters, setDraftOverviewFilters] = useState(() => createEmptyOverviewFilters());
  const [appliedOverviewFilters, setAppliedOverviewFilters] = useState(() => createEmptyOverviewFilters());
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [notesEnabled, setNotesEnabled] = useState(false);
  const [notesApiBase, setNotesApiBase] = useState("");
  const [notesUserId, setNotesUserId] = useState("");
  const [availableNoteUsers, setAvailableNoteUsers] = useState([]);
  const [notesMap, setNotesMap] = useState(new Map());
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesOnlyTagged, setNotesOnlyTagged] = useState(false);
  const [noteTagFilter, setNoteTagFilter] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState(null);
  const [reviewHint, setReviewHint] = useState("");
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteScopeHint, setNoteScopeHint] = useState("");
  const [noteTargetSkus, setNoteTargetSkus] = useState([]);
  const [noteTag, setNoteTag] = useState("");
  const [noteRemark, setNoteRemark] = useState("");
  const [noteFollowing, setNoteFollowing] = useState(true);
  const [savingNote, setSavingNote] = useState(false);

  const drillLevels = useMemo(() => getDrillLevels(drillMode), [drillMode]);

  useEffect(() => {
    void initializePage();
  }, []);

  useEffect(() => {
    setDrillPath([]);
  }, [drillMode]);

  useEffect(() => {
    runSearch(searchInput);
  }, [records, notesMap, notesOnlyTagged]);

  const hasMajorCategoryField = useMemo(
    () => records.some((record) => record && Object.prototype.hasOwnProperty.call(record, "major_category")),
    [records]
  );

  const overviewFilterConfig = useMemo(() => {
    const valuesByKey = createEmptyOverviewFilters();
    const items = ARRIVAL_OVERVIEW_FILTER_FIELDS.map((field) => {
      const values =
        field.key === "major_category" && !hasMajorCategoryField
          ? []
          : Array.from(new Set(records.map((record) => getFieldValue(record, field.key)))).sort((left, right) =>
              compareText(left, right)
            );
      valuesByKey[field.key] = values;
      return {
        ...field,
        options: values.map((value) => ({ label: value, value })),
      };
    });
    return { items, valuesByKey };
  }, [hasMajorCategoryField, records]);

  useEffect(() => {
    const validValuesByKey = overviewFilterConfig.valuesByKey;
    setDraftOverviewFilters((prev) => {
      const next = normalizeOverviewFilters(prev, validValuesByKey);
      return areOverviewFiltersEqual(prev, next) ? prev : next;
    });
    setAppliedOverviewFilters((prev) => {
      const next = normalizeOverviewFilters(prev, validValuesByKey);
      return areOverviewFiltersEqual(prev, next) ? prev : next;
    });
  }, [overviewFilterConfig]);

  const overviewFilteredRecords = useMemo(
    () => records.filter((record) => recordMatchesOverviewFilters(record, appliedOverviewFilters)),
    [appliedOverviewFilters, records]
  );

  const filteredRecords = useMemo(
    () =>
      drillPath.reduce(
        (items, item) => items.filter((record) => getFieldValue(record, item.key) === item.value),
        overviewFilteredRecords
      ),
    [drillPath, overviewFilteredRecords]
  );

  const activeLevel = drillLevels[Math.min(drillPath.length, drillLevels.length - 1)];

  const groupRows = useMemo(() => {
    if (!activeLevel) {
      return [];
    }
    if (activeLevel.key === "sku") {
      return filteredRecords
        .slice()
        .sort((left, right) => compareText(left.sku, right.sku))
        .map((record, index) => ({
          key: toText(record.sku) || `sku_${index}`,
          ...record,
        }));
    }
    return groupRecords(filteredRecords, activeLevel.key).sort((left, right) => compareText(left.value, right.value));
  }, [activeLevel, filteredRecords]);

  const noteUserOptions = useMemo(() => buildNoteUserOptions(availableNoteUsers), [availableNoteUsers]);
  const canSwitchNoteUser = noteUserOptions.length > 1;
  const hasDraftOverviewFilters = hasOverviewFilters(draftOverviewFilters);
  const hasAppliedOverviewFilters = hasOverviewFilters(appliedOverviewFilters);
  const overviewFiltersDirty = !areOverviewFiltersEqual(draftOverviewFilters, appliedOverviewFilters);

  const summaryCards = summary || computeSummary(records);
  const sourceFiles = statusData?.source_files || {};
  const stockSource = statusData?.stock_source || {};
  const detailPlanRows = Array.isArray(detailRecord?.plan_details) ? detailRecord.plan_details : [];
  const appliedOverviewFilterTags = useMemo(
    () =>
      ARRIVAL_OVERVIEW_FILTER_FIELDS.flatMap(({ key, label }) =>
        (appliedOverviewFilters[key] || []).map((value) => ({
          key: `${key}_${value}`,
          label: `${label}\uff1a${value}`,
        }))
      ),
    [appliedOverviewFilters]
  );

  const memoRows = useMemo(
    () =>
      records
        .map((record) => {
          const note = notesMap.get(normalizeToken(record.sku));
          if (!hasNoteContent(note)) {
            return null;
          }
          return { ...record, note };
        })
        .filter(Boolean)
        .sort(sortMemoRows),
    [records, notesMap]
  );

  const memoTagOptions = useMemo(
    () =>
      Array.from(new Set(memoRows.map((row) => toText(row.note?.tag)).filter(Boolean))).sort((left, right) =>
        compareText(left, right)
      ),
    [memoRows]
  );

  const filteredMemoRows = useMemo(
    () => memoRows.filter((row) => !noteTagFilter || toText(row.note?.tag) === noteTagFilter),
    [memoRows, noteTagFilter]
  );

  useEffect(() => {
    if (noteTagFilter && !memoTagOptions.includes(noteTagFilter)) {
      setNoteTagFilter("");
    }
  }, [memoTagOptions, noteTagFilter]);

  async function initializePage() {
    setLoading(true);
    try {
      const [authResp, statusResp, noteUsersResp] = await Promise.allSettled([
        http.get("/api/auth/me", { params: { _t: Date.now() } }),
        http.get("/api/arrival/status", { params: { _t: Date.now() } }),
        http.get("/api/arrival/note-users", { params: { _t: Date.now() } }),
      ]);
      const authPayload = authResp.status === "fulfilled" ? authResp.value.data || {} : {};
      const authUser = toText(authPayload.name || authPayload.username);
      const nextStatus = statusResp.status === "fulfilled" ? statusResp.value.data || null : null;
      const nextNoteUsers = normalizeNoteUsers(
        noteUsersResp.status === "fulfilled" ? noteUsersResp.value.data?.users : [],
        authUser
      );
      setAvailableNoteUsers(nextNoteUsers);
      setStatusData(nextStatus);
      applyNotesConfig(nextStatus?.config?.notes, authUser, nextNoteUsers);
      if (nextStatus?.has_data) {
        const dataResp = await http.get("/api/arrival/data", { params: { _t: Date.now() } });
        const payload = dataResp.data || {};
        const nextRecords = Array.isArray(payload.records) ? payload.records : [];
        setRecords(nextRecords);
        setSummary(payload.summary || computeSummary(nextRecords));
        setStatusBanner({ type: "success", text: "已加载最近一次新品快照。" });
      } else {
        setStatusBanner({ type: "warning", text: "当前暂无缓存数据，请点击更新。" });
      }
    } catch (err) {
      const text = err?.response?.data?.message || err.message || "加载新品入库看板失败";
      setStatusBanner({ type: "error", text });
      message.error(text);
    } finally {
      setLoading(false);
    }
  }

  function applyNotesConfig(notesConfig, authUser, users = availableNoteUsers) {
    const config = notesConfig || {};
    const enabled = config.enabled !== false;
    const apiBase = sanitizeApiBase(config.api_base_url || "/notes-api");
    const userId = pickPreferredNoteUser(users, getStoredValue(NOTES_USER_STORAGE_KEY), config.user_id, authUser);
    setNotesEnabled(enabled);
    setNotesApiBase(apiBase);
    setNotesUserId(userId);
    setNoteTagFilter("");
    if (!enabled) {
      setNotesMap(new Map());
      return;
    }
    if (userId && apiBase) {
      setStoredValue(NOTES_USER_STORAGE_KEY, userId);
      void loadUserNotes(userId, apiBase, false, enabled);
    } else {
      setNotesMap(new Map());
    }
  }

  async function loadUserNotes(userIdArg = notesUserId, apiBaseArg = notesApiBase, showSuccess = false, enabledArg = notesEnabled) {
    const userId = toText(userIdArg);
    const apiBase = sanitizeApiBase(apiBaseArg);
    if (!enabledArg || !userId || !apiBase) {
      return;
    }
    const requestId = notesRequestIdRef.current + 1;
    notesRequestIdRef.current = requestId;
    setNotesLoading(true);
    try {
      const resp = await http.get(`${apiBase}/notes`, {
        params: {
          user_id: userId,
          _t: Date.now(),
        },
      });
      if (notesRequestIdRef.current !== requestId) {
        return;
      }
      const nextMap = new Map();
      (resp.data?.notes || []).forEach((item) => {
        const note = normalizeNote(item);
        if (note.sku) {
          nextMap.set(normalizeToken(note.sku), note);
        }
      });
      setNotesMap(nextMap);
      setNoteTagFilter("");
      if (showSuccess) {
        message.success(`已同步 ${userId} 的 ${formatNumber(nextMap.size)} 条打标`);
      }
    } catch (err) {
      if (notesRequestIdRef.current !== requestId) {
        return;
      }
      message.error(err?.response?.data?.message || err.message || "同步备注失败");
    } finally {
      if (notesRequestIdRef.current === requestId) {
        setNotesLoading(false);
      }
    }
  }

  function runSearch(rawText) {
    const tokens = parseSearchTokens(rawText);
    const hasCurrentNote = (record) => hasNoteContent(notesMap.get(normalizeToken(record.sku)));
    if (!tokens.length) {
      if (!notesOnlyTagged) {
        setSearchResults([]);
        return;
      }
      const tagged = records.filter(hasCurrentNote).sort((left, right) => compareText(left.sku, right.sku));
      setSearchResults(tagged);
      return;
    }
    const normalized = tokens.map(normalizeToken).filter(Boolean);
    const matched = new Map();
    records.forEach((record) => {
      const skuKey = normalizeToken(record.sku);
      const styleKey = normalizeToken(record.style);
      if (normalized.some((token) => skuKey.includes(token) || styleKey.includes(token))) {
        matched.set(toText(record.sku), record);
      }
    });
    let nextResults = Array.from(matched.values()).sort((left, right) => compareText(left.sku, right.sku));
    if (notesOnlyTagged) {
      nextResults = nextResults.filter(hasCurrentNote);
    }
    setSearchResults(nextResults);
  }

  function updateOverviewFilterDraft(key, values) {
    setDraftOverviewFilters((prev) => ({
      ...prev,
      [key]: normalizeOverviewFilterValues(values),
    }));
  }

  function applyOverviewFilters() {
    setAppliedOverviewFilters(normalizeOverviewFilters(draftOverviewFilters, overviewFilterConfig.valuesByKey));
    setDrillPath([]);
  }

  function resetOverviewFilters() {
    setDraftOverviewFilters(createEmptyOverviewFilters());
    setAppliedOverviewFilters(createEmptyOverviewFilters());
    setDrillPath([]);
  }

  async function syncNotesUser(nextValue) {
    const userId = toText(nextValue);
    setNotesUserId(userId);
    setStoredValue(NOTES_USER_STORAGE_KEY, userId);
    setNotesMap(new Map());
    setNoteTagFilter("");
    if (userId && notesApiBase) {
      await loadUserNotes(userId, notesApiBase, true);
    }
  }

  async function reloadDashboardData(successText) {
    const [statusResp, dataResp] = await Promise.all([
      http.get("/api/arrival/status", { params: { _t: Date.now() } }),
      http.get("/api/arrival/data", { params: { _t: Date.now() } }),
    ]);
    const nextStatus = statusResp.data || null;
    const payload = dataResp.data || {};
    const nextRecords = Array.isArray(payload.records) ? payload.records : [];
    setStatusData(nextStatus);
    setRecords(nextRecords);
    setSummary(payload.summary || computeSummary(nextRecords));
    setDrillPath([]);
    setStatusBanner({ type: "success", text: successText });
    applyNotesConfig(nextStatus?.config?.notes, notesUserId, availableNoteUsers);
  }

  async function runManagedRefresh() {
    const resp = await http.post("/api/admin/refresh-arrival");
    const jobId = resp.data?.job?.id;
    if (!jobId) {
      throw new Error(resp.data?.message || "刷新任务返回异常");
    }
    while (true) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      const jobResp = await http.get(`/api/admin/jobs/${encodeURIComponent(jobId)}`, {
        params: { _t: Date.now() },
      });
      const job = jobResp.data?.job || null;
      if (!job) {
        throw new Error("刷新任务不存在");
      }
      if (job.status === "running") {
        setStatusBanner({ type: "info", text: "后台刷新进行中，请稍候..." });
        continue;
      }
      if (job.status !== "succeeded") {
        throw new Error(job.error || job.logs?.[job.logs.length - 1] || "刷新失败");
      }
      return;
    }
  }

  async function refreshDashboard() {
    if (refreshing) {
      return;
    }
    setRefreshing(true);
    setStatusBanner({ type: "info", text: "正在提交新品刷新任务..." });
    try {
      await runManagedRefresh();
      await reloadDashboardData("刷新完成，已重新加载新品入库看板。");
    } catch (err) {
      const text = String(err?.message || err || "").toLowerCase();
      if (text.includes("401") || text.includes("403") || text.includes("404")) {
        try {
          await http.post("/api/arrival/refresh");
          await reloadDashboardData("刷新完成，已重新加载新品入库看板。");
        } catch (fallbackErr) {
          const fallbackText = fallbackErr?.response?.data?.message || fallbackErr.message || "刷新失败";
          setStatusBanner({ type: "error", text: fallbackText });
          message.error(fallbackText);
        }
      } else {
        const messageText = err?.message || "刷新失败";
        setStatusBanner({ type: "error", text: messageText });
        message.error(messageText);
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function openDetail(record) {
    setDetailRecord(record);
    setDrawerOpen(true);
    if (!record?.sku || toNumber(record.unexec_qty) <= 0) {
      setReviewHint("");
      return;
    }
    try {
      const resp = await http.get("/api/arrival/review", {
        params: {
          sku: record.sku,
          _t: Date.now(),
        },
      });
      const issue = resp.data?.issue || null;
      const review = resp.data?.review || null;
      if (issue) {
        setReviewHint(
          `复核提示：${toText(issue.reason)}（计划行 ${formatNumber(issue.plan_rows_total)}，命中 ${formatNumber(issue.matched_rows)}）`
        );
      } else if (review) {
        setReviewHint(`复核结果：计划行 ${formatNumber(review.plan_rows_total)}，命中 ${formatNumber(review.matched_rows)}。`);
      } else {
        setReviewHint("");
      }
    } catch (_err) {
      setReviewHint("");
    }
  }

  function openSingleNote(record) {
    const sku = toText(record?.sku);
    const note = notesMap.get(normalizeToken(sku));
    if (!notesEnabled || !notesApiBase || !sku) {
      message.error("备注服务未配置");
      return;
    }
    setNoteTargetSkus([sku]);
    setNoteScopeHint("单货号备注");
    setNoteTag(note?.tag || "");
    setNoteRemark(note?.remark || "");
    setNoteFollowing(note ? !!note.is_following : true);
    setNoteModalOpen(true);
  }

  function openBatchNote() {
    const skus = Array.from(new Set(searchResults.map((record) => toText(record.sku)).filter(Boolean)));
    if (!notesEnabled || !notesApiBase || !skus.length) {
      message.error("请先检索出需要批量打标的货号");
      return;
    }
    setNoteTargetSkus(skus);
    setNoteScopeHint(`批量备注将应用到当前命中的 ${formatNumber(skus.length)} 个货号`);
    setNoteTag("");
    setNoteRemark("");
    setNoteFollowing(true);
    setNoteModalOpen(true);
  }

  async function saveNote() {
    const userId = toText(notesUserId);
    if (!userId || !noteTargetSkus.length) {
      message.error("请先选择打标用户");
      return;
    }
    setSavingNote(true);
    try {
      if (noteTargetSkus.length === 1) {
        const resp = await http.post(`${notesApiBase}/notes/upsert`, {
          sku: noteTargetSkus[0],
          user_id: userId,
          tag: noteTag.trim(),
          remark: noteRemark.trim(),
          is_following: noteFollowing,
          updated_by: userId,
        });
        const note = normalizeNote(resp.data?.note || {});
        if (note.sku) {
          setNotesMap((prev) => {
            const next = new Map(prev);
            next.set(normalizeToken(note.sku), note);
            return next;
          });
        }
      } else {
        const resp = await http.post(`${notesApiBase}/notes/bulk_upsert`, {
          skus: noteTargetSkus,
          user_id: userId,
          tag: noteTag.trim(),
          remark: noteRemark.trim(),
          is_following: noteFollowing,
          updated_by: userId,
        });
        const items = Array.isArray(resp.data?.notes) ? resp.data.notes : [];
        setNotesMap((prev) => {
          const next = new Map(prev);
          items.forEach((item) => {
            const note = normalizeNote(item);
            if (note.sku) {
              next.set(normalizeToken(note.sku), note);
            }
          });
          return next;
        });
      }
      setNoteModalOpen(false);
      message.success("备注已保存");
      runSearch(searchInput);
    } catch (err) {
      message.error(err?.response?.data?.message || err.message || "保存备注失败");
    } finally {
      setSavingNote(false);
    }
  }

  function locateRecord(record) {
    const nextDrillPath = drillLevels.slice(0, drillLevels.length - 1).map((level) => ({
      key: level.key,
      value: getFieldValue(record, level.key),
    }));
    if (!recordMatchesOverviewFilters(record, appliedOverviewFilters)) {
      const clearedFilters = createEmptyOverviewFilters();
      setDraftOverviewFilters(clearedFilters);
      setAppliedOverviewFilters(clearedFilters);
    }
    setDrillPath(nextDrillPath);
  }

  const skuBaseColumns = [
    {
      title: "货号",
      dataIndex: "sku",
      key: "sku",
      width: 140,
      fixed: "left",
      render: (value) => <SkuPreview sku={value} text={value} imageBasePath="/api/arrival/image" />,
    },
    { title: "款号", dataIndex: "style", key: "style", width: 120 },
    { title: "故事包", dataIndex: "story_pack", key: "story_pack", width: 110, render: (value) => toText(value) || "-" },
    { title: "产品季", dataIndex: "season", key: "season", width: 100, render: (value) => getFieldValue({ season: value }, "season") },
    { title: "性别", dataIndex: "gender", key: "gender", width: 90, render: (value) => getFieldValue({ gender: value }, "gender") },
    { title: "中类", dataIndex: "category", key: "category", width: 120, render: (value) => getFieldValue({ category: value }, "category") },
  ];

  const skuMetricColumns = [
    { title: "库存", dataIndex: "stock_qty", key: "stock_qty", width: 110, align: "center", render: (value) => formatNumber(value) },
    {
      title: "未执行量",
      dataIndex: "unexec_qty",
      key: "unexec_qty",
      width: 120,
      align: "center",
      render: (value) => <span className={toNumber(value) > 0 ? "arrival-metric-bad" : ""}>{formatNumber(value)}</span>,
    },
    { title: "未执行交期", dataIndex: "unexec_delivery_dates", key: "unexec_delivery_dates", width: 150, render: (value) => toText(value) || "-" },
    { title: "下周计划量", dataIndex: "plan_qty", key: "plan_qty", width: 120, align: "center", render: (value) => formatNumber(value) },
    { title: "计划最早日期", dataIndex: "plan_date", key: "plan_date", width: 140, render: (value) => toText(value) || "-" },
  ];

  const groupColumns =
    activeLevel?.key === "sku"
      ? [
          ...skuBaseColumns,
          ...skuMetricColumns,
          {
            title: "详情",
            key: "action",
            width: 100,
            fixed: "right",
            render: (_, row) => (
              <Button size="small" onClick={() => void openDetail(row)} disabled={toNumber(row.unexec_qty) <= 0}>
                查看
              </Button>
            ),
          },
        ]
      : [
          { title: activeLevel?.label || "维度", dataIndex: "value", key: "value", width: 160, fixed: "left", className: "cell-text-left" },
          { title: "货号数", dataIndex: "total_sku", key: "total_sku", width: 110, align: "center", render: (value) => formatNumber(value) },
          { title: "到货货号", dataIndex: "arrived_sku", key: "arrived_sku", width: 110, align: "center", render: (value) => formatNumber(value) },
          { title: "到货率", dataIndex: "arrival_rate", key: "arrival_rate", width: 160, render: (value) => buildArrivalRateNode(value) },
          { title: "库存", dataIndex: "stock_qty", key: "stock_qty", width: 120, align: "center", render: (value) => formatNumber(value) },
          {
            title: "未执行量",
            dataIndex: "unexec_qty",
            key: "unexec_qty",
            width: 120,
            align: "center",
            render: (value) => <span className={toNumber(value) > 0 ? "arrival-metric-bad" : ""}>{formatNumber(value)}</span>,
          },
          { title: "下周计划量", dataIndex: "plan_qty", key: "plan_qty", width: 120, align: "center", render: (value) => formatNumber(value) },
          { title: "计划最早日期", dataIndex: "plan_date", key: "plan_date", width: 140, render: (value) => toText(value) || "-" },
          {
            title: "查看",
            key: "drill",
            width: 100,
            fixed: "right",
            render: (_, row) => (
              <Button
                size="small"
                onClick={() =>
                  setDrillPath((prev) => [...prev, { key: activeLevel?.key || "", value: toText(row.value) || EMPTY_LABEL }])
                }
              >
                下钻
              </Button>
            ),
          },
        ];

  const searchColumns = [
    ...skuBaseColumns,
    ...skuMetricColumns,
    {
      title: "当前打标",
      key: "note",
      width: 200,
      render: (_, row) => {
        const note = notesMap.get(normalizeToken(row.sku));
        return (
          <span className={note?.is_following ? "arrival-note-followed" : ""} title={note?.remark || ""}>
            {formatNoteSummary(note)}
          </span>
        );
      },
    },
    {
      title: "操作",
      key: "action",
      width: 180,
      fixed: "right",
      render: (_, row) => (
        <Space size={4}>
          <Button size="small" onClick={() => locateRecord(row)}>
            定位
          </Button>
          <Button size="small" onClick={() => void openDetail(row)}>
            详情
          </Button>
          <Button size="small" onClick={() => openSingleNote(row)}>
            打标
          </Button>
        </Space>
      ),
    },
  ];

  const memoColumns = [
    ...skuBaseColumns,
    {
      title: "打标",
      key: "tag",
      width: 180,
      render: (_, row) => (
        <Space size={[4, 4]} wrap>
          {row.note?.is_following ? <Tag color="blue">跟进</Tag> : null}
          {row.note?.tag ? <Tag color="gold">{row.note.tag}</Tag> : <Text type="secondary">未设标签</Text>}
        </Space>
      ),
    },
    {
      title: "备注",
      key: "remark",
      width: 260,
      className: "cell-text-left",
      render: (_, row) => <div className="arrival-memo-note">{toText(row.note?.remark) || "-"}</div>,
    },
    {
      title: "更新时间",
      key: "updated_at",
      width: 170,
      render: (_, row) => toText(row.note?.updated_at) || "-",
    },
    {
      title: "操作",
      key: "action",
      width: 180,
      fixed: "right",
      render: (_, row) => (
        <Space size={4}>
          <Button size="small" onClick={() => locateRecord(row)}>
            定位
          </Button>
          <Button size="small" onClick={() => void openDetail(row)}>
            详情
          </Button>
          <Button size="small" onClick={() => openSingleNote(row)}>
            编辑
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <Card className="hero-card">
        <Title level={3} style={{ marginBottom: 8 }}>
          新品入库看板
        </Title>
        <Text type="secondary">统一在 React 内查看新品到货、库存、未执行、入库计划与打标备注。</Text>
      </Card>

      <Card bordered={false}>
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <Space wrap size={12}>
            <Button type="primary" icon={<ReloadOutlined />} loading={refreshing} onClick={() => void refreshDashboard()}>
              更新新品数据
            </Button>
            <Button
              icon={<PushpinOutlined />}
              loading={notesLoading}
              disabled={!notesEnabled || !notesUserId}
              onClick={() => void loadUserNotes(notesUserId, notesApiBase, true)}
            >
              同步打标
            </Button>
          </Space>
          <Alert type={statusBanner.type} showIcon message={statusBanner.text} />
          <Descriptions column={{ xs: 1, md: 2, xl: 4 }} bordered size="small">
            <Descriptions.Item label="库存来源">{toText(stockSource.label) || "-"}</Descriptions.Item>
            <Descriptions.Item label="库存快照日期">{toText(stockSource.inventory_snapshot_date) || "-"}</Descriptions.Item>
            <Descriptions.Item label="库存匹配货号">{formatNumber(stockSource.matched_sku_count)}</Descriptions.Item>
            <Descriptions.Item label="最近刷新">{toText(statusData?.last_refresh_at) || "-"}</Descriptions.Item>
            <Descriptions.Item label="货盘文件">{toText(sourceFiles.cargo) || "-"}</Descriptions.Item>
            <Descriptions.Item label="未执行文件">{toText(sourceFiles.unexecuted) || "-"}</Descriptions.Item>
            <Descriptions.Item label="计划文件">
              {Array.isArray(sourceFiles.plans) && sourceFiles.plans.length ? sourceFiles.plans.join("、") : "-"}
            </Descriptions.Item>
            <Descriptions.Item label="复核异常货号">{formatNumber(statusData?.plan_review_issue_count)}</Descriptions.Item>
          </Descriptions>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={12} md={8} xl={4}>
          <Card className="arrival-kpi-card">
            <Statistic title="货号总数" value={summaryCards?.total_sku || 0} formatter={(value) => formatNumber(value)} />
          </Card>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Card className="arrival-kpi-card">
            <Statistic title="款号总数" value={summaryCards?.total_style || 0} formatter={(value) => formatNumber(value)} />
          </Card>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Card className="arrival-kpi-card">
            <Statistic title="已到货货号" value={summaryCards?.arrived_sku || 0} formatter={(value) => formatNumber(value)} />
          </Card>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Card className="arrival-kpi-card">
            <Statistic title="到货率" value={formatPercent(summaryCards?.arrival_rate || 0)} />
          </Card>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Card className="arrival-kpi-card">
            <Statistic title="库存总量" value={summaryCards?.stock_qty_total || 0} formatter={(value) => formatNumber(value)} />
          </Card>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Card className="arrival-kpi-card">
            <Statistic title="未执行量" value={summaryCards?.unexec_qty_total || 0} formatter={(value) => formatNumber(value)} />
          </Card>
        </Col>
      </Row>

      <Card
        title="总览与下钻"
        bordered={false}
        extra={
          <Space wrap size={10}>
            <Text type="secondary">展开方式</Text>
            <Segmented
              options={DRILL_MODE_OPTIONS}
              value={drillMode}
              onChange={(value) => setDrillMode(String(value || DEFAULT_DRILL_MODE))}
            />
          </Space>
        }
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div className="arrival-filter-toolbar">
            <Space wrap size={12} className="compact-toolbar arrival-filter-fields">
              {overviewFilterConfig.items.map((field) => (
                <div key={field.key} className="arrival-filter-field">
                  <Text type="secondary">{field.label}</Text>
                  <Select
                    mode="multiple"
                    allowClear
                    showSearch
                    value={draftOverviewFilters[field.key]}
                    disabled={loading || (field.key === "major_category" && !hasMajorCategoryField)}
                    placeholder={field.placeholder}
                    style={{ width: field.key === "major_category" ? 220 : 180 }}
                    optionFilterProp="label"
                    maxTagCount="responsive"
                    options={field.options}
                    onChange={(values) => updateOverviewFilterDraft(field.key, values)}
                  />
                </div>
              ))}
              <Button type="primary" disabled={loading || !overviewFiltersDirty} onClick={applyOverviewFilters}>
                {"\u5e94\u7528\u7b5b\u9009"}
              </Button>
              <Button
                disabled={loading || (!hasDraftOverviewFilters && !hasAppliedOverviewFilters)}
                onClick={resetOverviewFilters}
              >
                {"\u91cd\u7f6e"}
              </Button>
            </Space>
            <Space wrap size={8}>
              <Tag color="geekblue">{`\u547d\u4e2d\u8d27\u53f7\uff1a${formatNumber(overviewFilteredRecords.length)}`}</Tag>
              {hasAppliedOverviewFilters
                ? appliedOverviewFilterTags.map((item) => (
                    <Tag key={item.key} color="cyan">
                      {item.label}
                    </Tag>
                  ))
                : <Tag>{`\u5df2\u5e94\u7528\uff1a\u5168\u90e8`}</Tag>}
            </Space>
          </div>
          <div className="arrival-breadcrumb-strip">
            <Space wrap>
              <Button size="small" type={drillPath.length === 0 ? "primary" : "default"} onClick={() => setDrillPath([])}>
                全部
              </Button>
              {drillPath.map((item, index) => (
                <Button
                  key={`${item.key}_${item.value}_${index}`}
                  size="small"
                  type={index === drillPath.length - 1 ? "primary" : "default"}
                  onClick={() => setDrillPath(drillPath.slice(0, index + 1))}
                >
                  {item.value}
                </Button>
              ))}
            </Space>
            <Button size="small" disabled={!drillPath.length} onClick={() => setDrillPath((prev) => prev.slice(0, -1))}>
              返回上一层
            </Button>
          </div>
          <Table
            rowKey="key"
            className="app-compact-table"
            columns={groupColumns}
            dataSource={groupRows}
            loading={loading}
            pagination={false}
            size="small"
            scroll={{ x: "max-content", y: 520 }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    hasAppliedOverviewFilters
                      ? "\u5f53\u524d\u7b5b\u9009\u6761\u4ef6\u4e0b\u6682\u65e0\u603b\u89c8\u6570\u636e"
                      : "\u5f53\u524d\u6682\u65e0\u603b\u89c8\u6570\u636e"
                  }
                />
              ),
            }}
          />
        </Space>
      </Card>

      <Card title="货号 / 款号检索" bordered={false}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Input.TextArea
            rows={3}
            value={searchInput}
            placeholder="输入货号或款号，支持换行、逗号、空格批量输入"
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <Space wrap size={12}>
            <Button type="primary" icon={<FileSearchOutlined />} onClick={() => runSearch(searchInput)}>
              检索
            </Button>
            <Button
              onClick={() => {
                setSearchInput("");
                setSearchResults([]);
              }}
            >
              清空
            </Button>
            <Space size={6}>
              <Text type="secondary">打标用户</Text>
              <Select
                showSearch
                value={notesUserId || undefined}
                disabled={!notesEnabled || !canSwitchNoteUser}
                placeholder="选择打标用户"
                style={{ width: 260 }}
                optionFilterProp="label"
                options={noteUserOptions.map((item) => ({ label: item.label, value: item.value }))}
                onChange={(value) => void syncNotesUser(value)}
              />
            </Space>
            <Checkbox checked={notesOnlyTagged} disabled={!notesEnabled} onChange={(event) => setNotesOnlyTagged(event.target.checked)}>
              仅看当前用户打标
            </Checkbox>
            <Button icon={<AppstoreOutlined />} disabled={!searchResults.length || !notesEnabled} onClick={openBatchNote}>
              批量打标命中货号
            </Button>
          </Space>
          <Text type="secondary">
            {searchInput.trim()
              ? `命中 ${formatNumber(searchResults.length)} 条`
              : notesOnlyTagged
                ? `${notesUserId || "当前用户"} 已打标 ${formatNumber(searchResults.length)} 条`
                : "输入货号或款号后可进行批量检索"}
          </Text>
          <Table
            rowKey={(row) => row.sku}
            className="app-compact-table"
            columns={searchColumns}
            dataSource={searchResults}
            pagination={{ pageSize: 20, showSizeChanger: true }}
            size="small"
            scroll={{ x: "max-content", y: 460 }}
          />
        </Space>
      </Card>

      <Card title="备忘录" bordered={false} extra={notesUserId ? <Tag color="blue">{notesUserId}</Tag> : null}>
        {!notesEnabled ? (
          <Alert type="warning" showIcon message="备注服务未启用，暂时无法查看打标备忘录。" />
        ) : (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Text type="secondary">按人和标签快速筛选当前打标内容，支持直接定位货号、查看详情和继续编辑。</Text>
            {canSwitchNoteUser ? (
              <Space wrap className="arrival-note-user-strip">
                {noteUserOptions.map((item) => (
                  <Button
                    key={item.value}
                    size="small"
                    type={item.value === notesUserId ? "primary" : "default"}
                    onClick={() => void syncNotesUser(item.value)}
                  >
                    {item.label}
                  </Button>
                ))}
              </Space>
            ) : (
              <Text type="secondary">当前账号仅可查看自己的打标内容。</Text>
            )}
            <Space wrap>
              <Button size="small" type={noteTagFilter === "" ? "primary" : "default"} onClick={() => setNoteTagFilter("")}>
                全部标签
              </Button>
              {memoTagOptions.map((item) => (
                <Button
                  key={item}
                  size="small"
                  type={noteTagFilter === item ? "primary" : "default"}
                  onClick={() => setNoteTagFilter(item)}
                >
                  {item}
                </Button>
              ))}
            </Space>
            <Text type="secondary">
              {notesUserId
                ? `${notesUserId} 当前共有 ${formatNumber(memoRows.length)} 条打标${noteTagFilter ? `，标签筛选：${noteTagFilter}` : ""}`
                : "请选择打标用户"}
            </Text>
            <Table
              rowKey={(row) => row.sku}
              className="app-compact-table"
              columns={memoColumns}
              dataSource={filteredMemoRows}
              loading={notesLoading}
              pagination={{ pageSize: 20, showSizeChanger: true }}
              size="small"
              scroll={{ x: "max-content", y: 420 }}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选条件下暂无备忘录" /> }}
            />
          </Space>
        )}
      </Card>

      <Drawer
        open={drawerOpen}
        width={520}
        destroyOnClose
        title={detailRecord ? `入库详情：${detailRecord.sku}${detailRecord.style ? ` / ${detailRecord.style}` : ""}` : "入库详情"}
        onClose={() => setDrawerOpen(false)}
      >
        {detailRecord ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="未执行量">{formatNumber(detailRecord.unexec_qty)}</Descriptions.Item>
              <Descriptions.Item label="未执行交期">{toText(detailRecord.unexec_delivery_dates) || "-"}</Descriptions.Item>
              <Descriptions.Item label="库存">{formatNumber(detailRecord.stock_qty)}</Descriptions.Item>
              <Descriptions.Item label="计划最早日期">{toText(detailRecord.plan_date) || "-"}</Descriptions.Item>
            </Descriptions>
            {reviewHint ? <Alert type="info" showIcon message={reviewHint} /> : null}
            <Card size="small" title={`入库计划明细（${formatNumber(detailPlanRows.length)} 条）`}>
              {detailPlanRows.length ? (
                <div className="arrival-plan-list">
                  {detailPlanRows.map((item, index) => (
                    <Card
                      key={`${detailRecord.sku}_${index}`}
                      size="small"
                      className="arrival-plan-detail-card"
                      title={
                        <Space wrap size={8}>
                          <Tag color="blue">计划 {index + 1}</Tag>
                          <Text type="secondary">计划日期：{toText(item.plan_date) || "-"}</Text>
                        </Space>
                      }
                    >
                      <Descriptions bordered size="small" column={1}>
                        <Descriptions.Item label="计划量">{formatNumber(item.plan_qty)}</Descriptions.Item>
                        <Descriptions.Item label="调整日期">{toText(item.adjust_date) || "-"}</Descriptions.Item>
                        <Descriptions.Item label="交货日期">{toText(item.delivery_date) || "-"}</Descriptions.Item>
                        <Descriptions.Item label="采购确认">{toText(item.purchase_confirm) || "-"}</Descriptions.Item>
                        <Descriptions.Item label="销售确认">{toText(item.sales_confirm) || "-"}</Descriptions.Item>
                        <Descriptions.Item label="物流确认">{toText(item.logistics_confirm) || "-"}</Descriptions.Item>
                        <Descriptions.Item label="备注">{toText(item.remark) || "-"}</Descriptions.Item>
                      </Descriptions>
                    </Card>
                  ))}
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无计划" />
              )}
            </Card>
          </Space>
        ) : null}
      </Drawer>

      <Modal
        open={noteModalOpen}
        title="打标备注"
        destroyOnHidden
        confirmLoading={savingNote}
        okText="保存"
        okButtonProps={{ icon: <SaveOutlined /> }}
        onCancel={() => setNoteModalOpen(false)}
        onOk={() => void saveNote()}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message={noteScopeHint}
            description={
              <Space direction="vertical" size={4}>
                <span>{noteTargetSkus.length === 1 ? noteTargetSkus[0] : `共 ${formatNumber(noteTargetSkus.length)} 个货号`}</span>
                <span>打标用户：{notesUserId || "-"}</span>
              </Space>
            }
          />
          <Input addonBefore="标签" value={noteTag} onChange={(event) => setNoteTag(event.target.value)} placeholder="例如：重点跟进 / 等仓 / 待确认" />
          <Input.TextArea rows={4} value={noteRemark} onChange={(event) => setNoteRemark(event.target.value)} placeholder="记录跟进信息、风险点、下一步动作" />
          <Checkbox checked={noteFollowing} onChange={(event) => setNoteFollowing(event.target.checked)}>
            计入当前用户跟进池
          </Checkbox>
        </Space>
      </Modal>
    </Space>
  );
}
