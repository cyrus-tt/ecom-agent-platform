import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  List,
  message,
  Row,
  Space,
  Spin,
  Statistic,
  Tag,
  Timeline,
  Typography,
  Upload,
} from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudUploadOutlined,
  DownloadOutlined,
  LoadingOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  artifactUrl,
  createTask,
  getTask,
  listTasks,
  subscribeEvents,
} from "../api/dispatch";

const { Title, Text, Paragraph } = Typography;

const STATE_META = {
  RECEIVED: { color: "default", label: "已创建" },
  CLEANING: { color: "processing", label: "清洗中" },
  CONFIRMING: { color: "warning", label: "等待确认" },
  DISPATCHING: { color: "processing", label: "计算调拨" },
  RENDERING: { color: "processing", label: "生成模板" },
  DONE: { color: "success", label: "完成" },
  FAILED: { color: "error", label: "失败" },
  INTERRUPTED: { color: "error", label: "已中断" },
};

const LEVEL_META = {
  info: { color: "blue", icon: <LoadingOutlined /> },
  milestone: { color: "green", icon: <CheckCircleOutlined /> },
  warn: { color: "orange", icon: <WarningOutlined /> },
  error: { color: "red", icon: <CloseCircleOutlined /> },
};

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export default function DispatchPage() {
  const [tasks, setTasks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [task, setTask] = useState(null);
  const [events, setEvents] = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pickedFiles, setPickedFiles] = useState({ demand: null, virtual: null, physical: null });

  async function refreshList() {
    try {
      const resp = await listTasks();
      setTasks(resp.tasks || []);
      if (!selectedId && resp.tasks && resp.tasks.length > 0) {
        setSelectedId(resp.tasks[0].id);
      }
    } catch (err) {
      message.error("加载任务列表失败: " + (err?.response?.data?.message || err.message));
    }
  }

  useEffect(() => {
    refreshList();
    const timer = setInterval(refreshList, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setTask(null);
      setEvents([]);
      setArtifacts([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getTask(selectedId)
      .then((resp) => {
        if (cancelled) return;
        setTask(resp.task);
        setEvents(resp.events || []);
        setArtifacts(resp.artifacts || []);
      })
      .catch((err) => {
        if (cancelled) return;
        message.error("加载任务失败: " + (err?.response?.data?.message || err.message));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const unsub = subscribeEvents(selectedId, (evt) => {
      setEvents((prev) => {
        if (prev.some((e) => e.id === evt.id)) return prev;
        return [...prev, evt];
      });
      // 刷新任务 meta + 产物
      getTask(selectedId).then((resp) => {
        setTask(resp.task);
        setArtifacts(resp.artifacts || []);
      }).catch(() => {});
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [selectedId]);

  async function handleUpload() {
    if (!pickedFiles.demand || !pickedFiles.virtual || !pickedFiles.physical) {
      message.warning("请上传 需求表 / 实仓表 / 虚仓表 三个文件");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("demand", pickedFiles.demand);
      fd.append("virtual", pickedFiles.virtual);
      fd.append("physical", pickedFiles.physical);
      fd.append("title", pickedFiles.demand.name.replace(/\.xlsx?$/i, ""));
      const resp = await createTask(fd);
      message.success("任务已创建: " + resp.task.id);
      setPickedFiles({ demand: null, virtual: null, physical: null });
      setSelectedId(resp.task.id);
      refreshList();
    } catch (err) {
      message.error("创建失败: " + (err?.response?.data?.message || err.message));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>调拨 Agent</Title>
      <Paragraph type="secondary">
        上传 需求表 / 实仓库存表 / 虚仓(分配池)库存表 三个 xlsx 文件,Agent 会自动清洗、异常回调确认、计算调拨方案,并生成 E3 导入模板。
      </Paragraph>

      <Row gutter={16}>
        {/* 左:任务列表 */}
        <Col span={6}>
          <Card title="任务列表" size="small">
            {tasks.length === 0 ? (
              <Empty description="暂无任务" />
            ) : (
              <List
                size="small"
                dataSource={tasks}
                renderItem={(t) => {
                  const meta = STATE_META[t.state] || { color: "default", label: t.state };
                  return (
                    <List.Item
                      style={{
                        cursor: "pointer",
                        background: selectedId === t.id ? "#e6f4ff" : undefined,
                        padding: "8px 12px",
                        borderRadius: 4,
                      }}
                      onClick={() => setSelectedId(t.id)}
                    >
                      <Space direction="vertical" size={2} style={{ width: "100%" }}>
                        <Space size={6}>
                          <Tag color={meta.color}>{meta.label}</Tag>
                          <Text ellipsis style={{ maxWidth: 150 }}>{t.title}</Text>
                        </Space>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {fmtTime(t.createdAt)} · {t.createdBy || "-"}
                        </Text>
                      </Space>
                    </List.Item>
                  );
                }}
              />
            )}
          </Card>
        </Col>

        {/* 中:时间轴 */}
        <Col span={12}>
          <Card
            title={task ? `任务 · ${task.title}` : "任务详情"}
            extra={task ? <Tag color={(STATE_META[task.state] || {}).color}>{(STATE_META[task.state] || {}).label || task.state}</Tag> : null}
            size="small"
          >
            {loading ? (
              <div style={{ padding: 40, textAlign: "center" }}><Spin /></div>
            ) : !task ? (
              <Empty description="选择一个任务或从右侧新建" />
            ) : (
              <>
                {task.error ? (
                  <Alert type="error" showIcon message="任务出错" description={task.error} style={{ marginBottom: 12 }} />
                ) : null}
                <Timeline
                  items={events.map((evt) => {
                    const meta = LEVEL_META[evt.level] || LEVEL_META.info;
                    return {
                      key: evt.id,
                      color: meta.color,
                      children: (
                        <div>
                          <Space size={8}>
                            <Text strong>{evt.message}</Text>
                            <Text type="secondary" style={{ fontSize: 11 }}>{fmtTime(evt.ts)} · {evt.phase}</Text>
                          </Space>
                          <EventDetail evt={evt} taskId={task.id} />
                        </div>
                      ),
                    };
                  })}
                />
                {events.length === 0 ? <Empty description="暂无事件" /> : null}
              </>
            )}
          </Card>
        </Col>

        {/* 右:上传 + 产物 */}
        <Col span={6}>
          <Card title="新建任务" size="small" style={{ marginBottom: 12 }}>
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <FilePicker
                label="需求表"
                file={pickedFiles.demand}
                onPick={(f) => setPickedFiles((p) => ({ ...p, demand: f }))}
              />
              <FilePicker
                label="实仓库存表"
                file={pickedFiles.physical}
                onPick={(f) => setPickedFiles((p) => ({ ...p, physical: f }))}
              />
              <FilePicker
                label="虚仓(分配池)库存表"
                file={pickedFiles.virtual}
                onPick={(f) => setPickedFiles((p) => ({ ...p, virtual: f }))}
              />
              <Button
                type="primary"
                icon={<CloudUploadOutlined />}
                loading={uploading}
                onClick={handleUpload}
                block
              >
                开始执行
              </Button>
            </Space>
          </Card>

          <Card title="产物" size="small">
            {artifacts.length === 0 ? (
              <Empty description="暂无产物" />
            ) : (
              <List
                size="small"
                dataSource={artifacts}
                renderItem={(a) => (
                  <List.Item
                    actions={[
                      <a
                        key="dl"
                        href={artifactUrl(task.id, a.name)}
                        download={a.name}
                      >
                        <DownloadOutlined /> 下载
                      </a>,
                    ]}
                  >
                    <Text ellipsis style={{ maxWidth: 180 }}>{a.name}</Text>
                  </List.Item>
                )}
              />
            )}
          </Card>

          {task && task.meta && task.meta.dispatchReport ? (
            <Card title="执行结果" size="small" style={{ marginTop: 12 }}>
              <Statistic title="成功行" value={task.meta.dispatchReport.okCount || 0} />
              <Statistic title="总件数" value={task.meta.dispatchReport.totalQty || 0} />
              <Statistic title="单据数" value={task.meta.dispatchReport.docCount || 0} />
            </Card>
          ) : null}
        </Col>
      </Row>
    </div>
  );
}

function FilePicker({ label, file, onPick }) {
  return (
    <div>
      <Text>{label}</Text>
      <Upload
        accept=".xlsx,.xls"
        beforeUpload={(f) => {
          onPick(f);
          return false;
        }}
        maxCount={1}
        fileList={file ? [{ uid: "1", name: file.name, status: "done" }] : []}
        onRemove={() => onPick(null)}
      >
        <Button size="small" block>{file ? "重新选择" : "选择文件"}</Button>
      </Upload>
    </div>
  );
}

function EventDetail({ evt, taskId }) {
  const payload = evt.payload || {};
  if (evt.phase === "CLEANED" && payload.warnings && payload.warnings.length > 0) {
    return (
      <ul style={{ margin: "4px 0 0 16px", color: "#fa8c16", fontSize: 12 }}>
        {payload.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
        {payload.warnings.length > 5 ? <li>...还有 {payload.warnings.length - 5} 项</li> : null}
      </ul>
    );
  }
  if (evt.phase === "CONFIRM_REQUESTED" || evt.phase === "CONFIRM_NO_DINGTALK") {
    return (
      <div style={{ marginTop: 6 }}>
        <a href={payload.confirmUrl} target="_blank" rel="noreferrer">
          <Button size="small" type="dashed">打开确认页(代需求人操作)</Button>
        </a>
      </div>
    );
  }
  if (evt.phase === "DISPATCHED") {
    return (
      <Space size={8} style={{ marginTop: 4, fontSize: 12 }}>
        <Tag>成功 {payload.okCount || 0}</Tag>
        <Tag>总件 {payload.totalQty || 0}</Tag>
        <Tag>单据 {payload.docCount || 0}</Tag>
        {payload.noBarcode && payload.noBarcode.length > 0 ? (
          <Tag color="orange">缺条码 {payload.noBarcode.length}</Tag>
        ) : null}
        {payload.noVirtualStock && payload.noVirtualStock.length > 0 ? (
          <Tag color="red">虚仓不足 {payload.noVirtualStock.length}</Tag>
        ) : null}
      </Space>
    );
  }
  return null;
}
