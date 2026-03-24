import { Alert, Button, Card, Col, DatePicker, Empty, Input, Radio, Row, Space, Table, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import http from "../api/http";
import { formatTextOrDash } from "../utils/numbers";

const { RangePicker } = DatePicker;
const { TextArea } = Input;
const { Title, Text } = Typography;

function formatDateTime(text) {
  if (!text) {
    return "-";
  }
  const date = dayjs(text);
  return date.isValid() ? date.format("YYYY-MM-DD HH:mm:ss") : "-";
}

function resolveDefaultRange(periodType, latestDate) {
  if (!latestDate) {
    return [];
  }
  const end = dayjs(latestDate, "YYYY-MM-DD");
  if (!end.isValid()) {
    return [];
  }
  const days = periodType === "day" ? 1 : periodType === "month" ? 30 : 7;
  return [end.subtract(days - 1, "day"), end];
}

function normalizeSkills(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: String(item?.id || "").trim(),
      name: String(item?.name || "").trim(),
      description: String(item?.description || "").trim(),
      prompt: String(item?.prompt || "").trim(),
    }))
    .filter((item) => item.id && item.name);
}

export default function AnalysisPage() {
  const [periodType, setPeriodType] = useState("week");
  const [salesDates, setSalesDates] = useState([]);
  const [range, setRange] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ type: "info", text: "请先选择周期和技能后生成报告。" });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [report, setReport] = useState(null);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skills, setSkills] = useState([]);
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [promptDrafts, setPromptDrafts] = useState({});

  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    if (!salesDates.length) {
      return;
    }
    setRange(resolveDefaultRange(periodType, salesDates[0]));
  }, [periodType, salesDates]);

  const currentSkill = useMemo(
    () => skills.find((item) => item.id === selectedSkillId) || skills[0] || null,
    [selectedSkillId, skills]
  );

  const currentPrompt = currentSkill ? promptDrafts[currentSkill.id] ?? currentSkill.prompt : "";

  const init = async () => {
    setSkillsLoading(true);
    try {
      const [datesResp, historyResp, skillsResp] = await Promise.all([
        http.get("/api/report-daily/dates", { params: { _t: Date.now() } }),
        http.get("/api/agent/reports", { params: { page: 1, pageSize: 20, _t: Date.now() } }),
        http.get("/api/agent/skills", { params: { _t: Date.now() } }),
      ]);

      const dates = Array.isArray(datesResp.data?.sales_dates) ? datesResp.data.sales_dates : [];
      setSalesDates(dates);
      setRange(resolveDefaultRange(periodType, dates[0]));

      const skillItems = normalizeSkills(skillsResp.data?.items);
      const defaultSkillId = String(skillsResp.data?.default_skill_id || skillItems[0]?.id || "");
      setSkills(skillItems);
      setSelectedSkillId(defaultSkillId);
      setPromptDrafts(
        skillItems.reduce((accumulator, item) => {
          accumulator[item.id] = item.prompt;
          return accumulator;
        }, {})
      );

      const items = Array.isArray(historyResp.data?.items) ? historyResp.data.items : [];
      setHistory(items);
      if (items[0]?.id) {
        await viewReport(items[0].id);
      }
      setStatus({ type: "success", text: "系统就绪，可开始生成分析报告。" });
    } catch (err) {
      setStatus({ type: "error", text: err?.response?.data?.message || err.message || "初始化失败" });
    } finally {
      setSkillsLoading(false);
    }
  };

  const refreshHistory = async () => {
    setHistoryLoading(true);
    try {
      const resp = await http.get("/api/agent/reports", { params: { page: 1, pageSize: 20, _t: Date.now() } });
      const items = Array.isArray(resp.data?.items) ? resp.data.items : [];
      setHistory(items);
    } catch (err) {
      message.error(err?.response?.data?.message || err.message || "读取历史报告失败");
    } finally {
      setHistoryLoading(false);
    }
  };

  const viewReport = async (id) => {
    const resp = await http.get(`/api/agent/reports/${encodeURIComponent(id)}`, { params: { _t: Date.now() } });
    setReport(resp.data?.report || null);
  };

  const handleSkillSelect = (skillId) => {
    setSelectedSkillId(skillId);
    setPromptDrafts((prev) => {
      if (prev[skillId] !== undefined) {
        return prev;
      }
      const skill = skills.find((item) => item.id === skillId);
      return {
        ...prev,
        [skillId]: skill?.prompt || "",
      };
    });
  };

  const handlePromptChange = (event) => {
    const nextValue = String(event.target.value || "");
    if (!currentSkill) {
      return;
    }
    setPromptDrafts((prev) => ({
      ...prev,
      [currentSkill.id]: nextValue,
    }));
  };

  const resetPrompt = () => {
    if (!currentSkill) {
      return;
    }
    setPromptDrafts((prev) => ({
      ...prev,
      [currentSkill.id]: currentSkill.prompt,
    }));
  };

  const runReport = async () => {
    if (loading) {
      return;
    }
    if (!Array.isArray(range) || range.length !== 2 || !range[0] || !range[1]) {
      setStatus({ type: "error", text: "请先选择开始和结束日期。" });
      return;
    }
    if (!currentSkill) {
      setStatus({ type: "error", text: "请先选择分析技能。" });
      return;
    }

    const startDate = range[0].format("YYYY-MM-DD");
    const endDate = range[1].format("YYYY-MM-DD");
    setLoading(true);
    setStatus({ type: "info", text: "正在计算指标并生成报告，请稍候..." });

    try {
      const resp = await http.post("/api/agent/run", {
        period_type: periodType,
        start_date: startDate,
        end_date: endDate,
        skill_id: currentSkill.id,
        prompt_text: currentPrompt,
      });
      const data = resp.data || {};
      if (data.ok === false) {
        setStatus({ type: "error", text: data.message || "报告生成失败" });
        return;
      }

      setReport({
        id: data.report_id,
        period_type: periodType,
        period_start: startDate,
        period_end: endDate,
        skill_id: data.skill_id || currentSkill.id,
        skill_name: data.skill_name || currentSkill.name,
        prompt_text: data.prompt_text || currentPrompt,
        report_md: data.report_md,
        status: "success",
        created_at: data.created_at,
      });
      setStatus({ type: "success", text: `报告生成成功，ID: ${data.report_id}` });
      await refreshHistory();
    } catch (err) {
      setStatus({ type: "error", text: err?.response?.data?.message || err.message || "报告生成失败" });
    } finally {
      setLoading(false);
    }
  };

  const disabledDate = (value) => {
    if (!value || !salesDates.length) {
      return false;
    }
    return !salesDates.includes(value.format("YYYY-MM-DD"));
  };

  const historyColumns = useMemo(
    () => [
      { title: "ID", dataIndex: "id", key: "id", width: 90 },
      { title: "周期", dataIndex: "period_type", key: "period_type", width: 90 },
      {
        title: "技能",
        dataIndex: "skill_name",
        key: "skill_name",
        width: 120,
        render: (text) => formatTextOrDash(text),
      },
      {
        title: "范围",
        key: "period",
        render: (_, row) => `${row.period_start || "-"} ~ ${row.period_end || "-"}`,
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        width: 90,
        render: (text) => <Tag color={text === "success" ? "green" : "red"}>{text || "-"}</Tag>,
      },
      {
        title: "创建时间",
        dataIndex: "created_at",
        key: "created_at",
        width: 180,
        render: (text) => formatDateTime(text),
      },
      {
        title: "操作",
        key: "action",
        width: 100,
        render: (_, row) => (
          <Button size="small" onClick={() => viewReport(row.id)}>
            查看
          </Button>
        ),
      },
    ],
    []
  );

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card className="hero-card" size="small">
        <Title level={3} style={{ marginBottom: 8 }}>
          经营分析 Agent
        </Title>
        <Text type="secondary">仅使用聚合指标调用 AI，不传 SKU / 款号 / 品名明细，可按技能模板调整分析 prompt。</Text>
      </Card>

      <Card title="分析参数" bordered={false} size="small" className="dense-card">
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Radio.Group value={periodType} onChange={(event) => setPeriodType(event.target.value)}>
            <Radio.Button value="day">日</Radio.Button>
            <Radio.Button value="week">周</Radio.Button>
            <Radio.Button value="month">月</Radio.Button>
          </Radio.Group>
          <Space wrap>
            <RangePicker value={range} onChange={(values) => setRange(values || [])} disabledDate={disabledDate} allowClear={false} />
            <Button type="primary" loading={loading} onClick={runReport}>
              生成分析
            </Button>
            <Button onClick={refreshHistory} loading={historyLoading}>
              刷新历史
            </Button>
          </Space>
          <Alert type={status.type} showIcon message={status.text} />
        </Space>
      </Card>

      <Card title="技能模板与 Prompt" bordered={false} size="small" className="dense-card" loading={skillsLoading}>
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <Row gutter={[12, 12]}>
            {skills.map((skill) => (
              <Col xs={24} md={12} xl={6} key={skill.id}>
                <button
                  type="button"
                  className={`analysis-skill-card ${selectedSkillId === skill.id ? "is-active" : ""}`}
                  onClick={() => handleSkillSelect(skill.id)}
                >
                  <span className="analysis-skill-name">{skill.name}</span>
                  <span className="analysis-skill-desc">{skill.description}</span>
                </button>
              </Col>
            ))}
          </Row>

          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Space wrap align="center">
              <Text strong>当前技能：</Text>
              <Tag color="blue">{currentSkill?.name || "-"}</Tag>
              <Button size="small" onClick={resetPrompt} disabled={!currentSkill}>
                恢复模板
              </Button>
            </Space>
            <TextArea
              rows={7}
              value={currentPrompt}
              onChange={handlePromptChange}
              placeholder="选择 skill 后可修改 prompt"
            />
          </Space>
        </Space>
      </Card>

      <Card
        title="当前报告"
        bordered={false}
        size="small"
        extra={
          report ? (
            <Text type="secondary">
              ID: {report.id} | 周期: {report.period_type} | 技能: {formatTextOrDash(report.skill_name)} | 创建: {formatDateTime(report.created_at)}
            </Text>
          ) : null
        }
      >
        {report?.report_md ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {report?.prompt_text ? (
              <Alert
                type="info"
                showIcon
                message={`本次技能：${formatTextOrDash(report.skill_name)}`}
                description={report.prompt_text}
              />
            ) : null}
            <div className="markdown-card">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.report_md}</ReactMarkdown>
            </div>
          </Space>
        ) : (
          <Empty description="暂无报告" />
        )}
      </Card>

      <Card title="历史报告" bordered={false} size="small">
        <Table
          rowKey={(row) => row.id}
          className="app-compact-table"
          columns={historyColumns}
          dataSource={history}
          loading={historyLoading}
          pagination={false}
          size="small"
          scroll={{ x: 860 }}
        />
      </Card>
    </Space>
  );
}
