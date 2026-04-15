import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Input, message, Radio, Space, Spin, Table, Typography } from "antd";
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

  const tableData = useMemo(() => {
    if (!data) return [];
    return data.rows.map((row, idx) => {
      const rowNum = data.rowNums[idx] || idx + 2;
      const obj = { _rowNum: rowNum, _key: idx };
      data.headers.forEach((h, j) => { obj[`c${j}`] = row[j]; });
      obj._issue = issueByRowNum.get(rowNum) || null;
      return obj;
    });
  }, [data, issueByRowNum]);

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
    return cols;
  }, [data]);

  function rowClassName(record) {
    return record._issue ? "dispatch-row-issue" : "";
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

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      <style>{`.dispatch-row-issue td { background: #fff7e6 !important; }`}</style>
      <Title level={3}>调拨需求确认 · {data.title}</Title>
      <Paragraph type="secondary">
        检测到 <Text strong>{data.issues.length}</Text> 项异常(下方表格中黄色背景行)。请逐项选择处理方式,然后提交。
      </Paragraph>

      <Card title="需求表预览(异常行高亮)" size="small" style={{ marginBottom: 16 }}>
        <Table
          size="small"
          rowKey="_key"
          columns={columns}
          dataSource={tableData}
          pagination={{ pageSize: 20 }}
          scroll={{ x: true }}
          rowClassName={rowClassName}
        />
      </Card>

      <Card title="异常项处理" size="small" style={{ marginBottom: 16 }}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {data.issues.map((iss, i) => (
            <div key={iss.id} style={{ padding: 10, background: "#fafafa", borderRadius: 4 }}>
              <div style={{ marginBottom: 6 }}>
                <Text strong>#{i + 1}</Text> · 第 {iss.rowNum || "?"} 行 · {iss.description}
              </div>
              <Radio.Group
                value={responses[`issue_${iss.index}`]}
                onChange={(e) => setResponses((p) => ({ ...p, [`issue_${iss.index}`]: e.target.value }))}
              >
                {iss.options.map((opt) => (
                  <Radio key={opt.value} value={opt.value}>{opt.label}</Radio>
                ))}
              </Radio.Group>
            </div>
          ))}

          <div>
            <Text>补充说明(可选)</Text>
            <Input.TextArea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="例如:第3行删除,第7行确认"
            />
          </div>

          <Button type="primary" size="large" loading={submitting} onClick={handleSubmit}>
            提交确认
          </Button>
        </Space>
      </Card>
    </div>
  );
}
