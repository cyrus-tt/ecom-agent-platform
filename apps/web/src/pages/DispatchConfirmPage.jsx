import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Input, message, Radio, Space, Spin, Table, Tag, Tooltip, Typography } from "antd";
import axios from "axios";

const { Title, Paragraph, Text } = Typography;

function parseTaskId() {
  const m = window.location.pathname.match(/\/dispatch\/confirm\/([^/?#]+)/);
  return m ? m[1] : "";
}
function parseToken() {
  const p = new URLSearchParams(window.location.search);
  return p.get("token") || "";
}

export default function DispatchConfirmPage() {
  const taskId = parseTaskId();
  const token = parseToken();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [responses, setResponses] = useState({});
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("缺少 token 参数");
      setLoading(false);
      return;
    }
    axios.get("/api/dispatch/public/preview", { params: { token } })
      .then((resp) => {
        setData(resp.data);
      })
      .catch((err) => {
        setError(err?.response?.data?.message || err.message);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const issueByRowNum = useMemo(() => {
    const map = new Map();
    if (data && data.issues) {
      for (const iss of data.issues) {
        if (iss.rowNum != null) map.set(iss.rowNum, iss);
      }
    }
    return map;
  }, [data]);

  const issueByRowIndex = useMemo(() => {
    const map = new Map();
    if (data && data.issues) {
      for (const iss of data.issues) {
        if (typeof iss.rowIndex === "number") map.set(iss.rowIndex, iss);
      }
    }
    return map;
  }, [data]);

  const tableData = useMemo(() => {
    if (!data) return [];
    return data.rows.map((row, idx) => {
      const rowNum = data.rowNums[idx] || idx + 2;
      const obj = { _rowNum: rowNum, _key: idx };
      data.headers.forEach((h, j) => { obj[`c${j}`] = row[j]; });
      obj._issue = issueByRowNum.get(rowNum) || issueByRowIndex.get(idx) || null;
      return obj;
    });
  }, [data, issueByRowNum, issueByRowIndex]);

  function renderIssueCell(issue) {
    if (!issue) return <Text type="secondary">—</Text>;
    let reasonLabel = "异常";
    let reasonColor = "orange";
    if (issue.type === "size_substitution") {
      reasonLabel = `换大一码 → ${issue.candidateSize}`;
      reasonColor = "gold";
    } else if (issue.type === "duplicate") {
      reasonLabel = "同单重复条码";
      reasonColor = "volcano";
    } else if (issue.description && issue.description.includes("地址矛盾")) {
      reasonLabel = "地址矛盾";
    } else if (issue.description && issue.description.includes("数量无效")) {
      reasonLabel = "数量无效";
    }
    const detail = issue.type === "size_substitution"
      ? (issue.scenario === "B"
          ? `${issue.sku} ${issue.originalSize}: 需 ${issue.qty} / 可发 ${issue.fulfilled} / 缺 ${issue.missingQty}，候选 ${issue.candidateSize}(实仓 ${issue.physicalAvailable}/虚仓 ${issue.virtualAvailable})`
          : `${issue.sku} ${issue.originalSize}: 需 ${issue.qty} 全部缺货，候选 ${issue.candidateSize}(实仓 ${issue.physicalAvailable}/虚仓 ${issue.virtualAvailable})`)
      : issue.description;
    return (
      <div>
        <Tooltip title={detail}>
          <Tag color={reasonColor} style={{ marginBottom: 6 }}>{reasonLabel}</Tag>
        </Tooltip>
        <Radio.Group
          size="small"
          value={responses[`issue_${issue.index}`]}
          onChange={(e) => setResponses((p) => ({ ...p, [`issue_${issue.index}`]: e.target.value }))}
        >
          <Space direction="vertical" size={2}>
            {issue.options.map((opt) => (
              <Radio key={opt.value} value={opt.value}>{opt.label}</Radio>
            ))}
          </Space>
        </Radio.Group>
      </div>
    );
  }

  const columns = useMemo(() => {
    if (!data) return [];
    const cols = [{
      title: "行号",
      dataIndex: "_rowNum",
      width: 60,
      fixed: "left",
    }];
    data.headers.forEach((h, j) => {
      cols.push({ title: h, dataIndex: `c${j}`, ellipsis: true });
    });
    cols.push({
      title: "异常 / 处理",
      dataIndex: "_issue",
      width: 260,
      fixed: "right",
      render: (_v, record) => renderIssueCell(record._issue),
    });
    return cols;
  }, [data, responses]);

  function rowClassName(record) {
    if (!record._issue) return "";
    if (record._issue.type === "size_substitution") return "dispatch-row-size";
    if (record._issue.type === "duplicate") return "dispatch-row-dup";
    return "dispatch-row-issue";
  }

  async function handleSubmit() {
    if (!data || !data.issues) return;
    for (const iss of data.issues) {
      const k = `issue_${iss.index}`;
      if (!responses[k]) {
        message.warning(`请先为异常项 #${iss.index + 1} 做选择`);
        return;
      }
    }
    setSubmitting(true);
    try {
      await axios.post("/api/dispatch/public/confirm",
        { token, responses: { ...responses, _comment: comment } },
        { params: { token } });
      setDone(true);
      message.success("已提交,感谢!");
    } catch (err) {
      message.error("提交失败: " + (err?.response?.data?.message || err.message));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center" }}><Spin tip="加载中..." /></div>;
  }
  if (error) {
    return (
      <div style={{ padding: 40 }}>
        <Alert type="error" showIcon message="无法加载" description={error} />
      </div>
    );
  }
  if (done) {
    return (
      <div style={{ padding: 60, textAlign: "center" }}>
        <Title level={3}>✅ 已收到您的确认</Title>
        <Paragraph>Agent 会根据您的选择继续处理调拨任务。页面可以关闭。</Paragraph>
      </div>
    );
  }
  if (!data) return <Empty />;

  const isSizeKind = data.issueKind === "size_substitution";

  return (
    <div style={{ padding: 24, maxWidth: 1600, margin: "0 auto" }}>
      <style>{`
        .dispatch-row-issue td { background: #fff7e6 !important; }
        .dispatch-row-size td { background: #fffbe6 !important; }
        .dispatch-row-dup td { background: #fff1f0 !important; }
      `}</style>
      <Title level={3}>
        {isSizeKind ? "尺码替代确认" : "调拨需求确认"} · {data.title}
      </Title>
      <Paragraph type="secondary">
        检测到 <Text strong>{data.issues.length}</Text> 项异常(黄色/红色背景行)。直接在表格右侧的「异常 / 处理」列中逐行勾选处理方式,然后点底部提交。
      </Paragraph>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Table
          size="small"
          rowKey="_key"
          columns={columns}
          dataSource={tableData}
          pagination={{ pageSize: 30 }}
          scroll={{ x: true }}
          rowClassName={rowClassName}
        />
      </Card>

      <Card size="small">
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div>
            <Text>补充说明(可选)</Text>
            <Input.TextArea
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="例如:这批货急用"
            />
          </div>
          <Button type="primary" size="large" loading={submitting} onClick={handleSubmit}>
            提交确认({data.issues.length} 项)
          </Button>
        </Space>
      </Card>
    </div>
  );
}
