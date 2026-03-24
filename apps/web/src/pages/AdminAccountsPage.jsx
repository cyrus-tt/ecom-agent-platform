import { KeyOutlined, PlusOutlined, ReloadOutlined, SafetyCertificateOutlined, SaveOutlined, UserAddOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Checkbox, Descriptions, Drawer, Input, Modal, Space, Table, Tag, Typography, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import http from "../api/http";
import { useAuth } from "../auth/AuthContext";

const { Title, Text } = Typography;

function sortPermissions(permissionKeys, modules) {
  const selected = new Set((Array.isArray(permissionKeys) ? permissionKeys : []).map((item) => String(item || "").trim()).filter(Boolean));
  return (Array.isArray(modules) ? modules : []).map((item) => item.key).filter((key) => selected.has(key));
}

function permissionsToMap(accounts) {
  return (Array.isArray(accounts) ? accounts : []).reduce((accumulator, account) => {
    accumulator[account.id] = Array.isArray(account.permissions) ? account.permissions : [];
    return accumulator;
  }, {});
}

export default function AdminAccountsPage() {
  const { auth } = useAuth();
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [modules, setModules] = useState([]);
  const [sharedUsername, setSharedUsername] = useState("");
  const [draftPermissions, setDraftPermissions] = useState({});
  const [savingAccountId, setSavingAccountId] = useState("");
  const [passwordAccountId, setPasswordAccountId] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountPassword, setNewAccountPassword] = useState("");
  const [newAccountPermissions, setNewAccountPermissions] = useState([]);
  const [passwordModal, setPasswordModal] = useState({ open: false, account: null, value: "" });

  useEffect(() => {
    void loadAccounts();
  }, []);

  async function loadAccounts() {
    setLoading(true);
    try {
      const resp = await http.get("/api/admin/accounts", {
        params: { _t: Date.now() },
      });
      const nextModules = Array.isArray(resp.data?.modules) ? resp.data.modules : [];
      const nextAccounts = Array.isArray(resp.data?.accounts) ? resp.data.accounts : [];
      setModules(nextModules);
      setAccounts(nextAccounts);
      setSharedUsername(String(resp.data?.shared_username || ""));
      setDraftPermissions(
        Object.entries(permissionsToMap(nextAccounts)).reduce((accumulator, [accountId, permissions]) => {
          accumulator[accountId] = sortPermissions(permissions, nextModules);
          return accumulator;
        }, {})
      );
    } catch (err) {
      message.error(err?.response?.data?.message || err.message || "读取账号权限失败");
    } finally {
      setLoading(false);
    }
  }

  function updateDraftPermission(accountId, moduleKey, checked) {
    setDraftPermissions((prev) => {
      const current = new Set(prev[accountId] || []);
      if (checked) {
        current.add(moduleKey);
      } else {
        current.delete(moduleKey);
      }
      return {
        ...prev,
        [accountId]: sortPermissions(Array.from(current), modules),
      };
    });
  }

  function isPermissionDirty(account) {
    const draft = sortPermissions(draftPermissions[account.id] || [], modules);
    const source = sortPermissions(account.permissions || [], modules);
    return draft.join(",") !== source.join(",");
  }

  async function savePermissions(account) {
    setSavingAccountId(account.id);
    try {
      await http.patch(`/api/admin/accounts/${encodeURIComponent(account.id)}/permissions`, {
        permissions: draftPermissions[account.id] || [],
      });
      message.success(`已更新 ${account.name} 的权限`);
      await loadAccounts();
    } catch (err) {
      message.error(err?.response?.data?.message || err.message || "保存权限失败");
    } finally {
      setSavingAccountId("");
    }
  }

  async function createAccount() {
    const nextName = String(newAccountName || "").trim();
    const nextPassword = String(newAccountPassword || "");
    if (!nextName) {
      message.error("请填写子账号显示名");
      return;
    }
    if (!nextPassword) {
      message.error("请填写子账号密码");
      return;
    }
    setLoading(true);
    try {
      await http.post("/api/admin/accounts", {
        name: nextName,
        password: nextPassword,
        permissions: newAccountPermissions,
      });
      message.success(`已创建子账号 ${nextName}`);
      setDrawerOpen(false);
      setNewAccountName("");
      setNewAccountPassword("");
      setNewAccountPermissions([]);
      await loadAccounts();
    } catch (err) {
      message.error(err?.response?.data?.message || err.message || "创建子账号失败");
    } finally {
      setLoading(false);
    }
  }

  async function savePassword() {
    const account = passwordModal.account;
    const nextPassword = String(passwordModal.value || "");
    if (!account) {
      return;
    }
    if (!nextPassword) {
      message.error("请填写新密码");
      return;
    }
    setPasswordAccountId(account.id);
    try {
      await http.patch(`/api/admin/accounts/${encodeURIComponent(account.id)}/password`, {
        password: nextPassword,
      });
      message.success(`已重置 ${account.name} 的密码`);
      setPasswordModal({ open: false, account: null, value: "" });
    } catch (err) {
      message.error(err?.response?.data?.message || err.message || "重置密码失败");
    } finally {
      setPasswordAccountId("");
    }
  }

  const columns = useMemo(() => {
    const moduleColumns = modules.map((module) => ({
      title: module.label,
      key: module.key,
      width: 92,
      align: "center",
      render: (_, row) => (
        <Checkbox
          checked={(draftPermissions[row.id] || []).includes(module.key)}
          disabled={row.is_primary_admin || savingAccountId === row.id}
          onChange={(event) => updateDraftPermission(row.id, module.key, event.target.checked)}
        />
      ),
    }));

    return [
      {
        title: "账号",
        key: "account",
        width: 240,
        fixed: "left",
        render: (_, row) => (
          <Space direction="vertical" size={4}>
            <Space wrap size={6}>
              <Text strong>{row.name}</Text>
              {row.is_primary_admin ? <Tag color="gold">主账号</Tag> : <Tag color="blue">子账号</Tag>}
              {auth?.accountId === row.id ? <Tag color="processing">当前登录</Tag> : null}
            </Space>
            <Text type="secondary">登录名固定为：{sharedUsername || row.username}</Text>
          </Space>
        ),
      },
      ...moduleColumns,
      {
        title: "操作",
        key: "action",
        width: 220,
        fixed: "right",
        render: (_, row) => (
          <Space wrap>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={savingAccountId === row.id}
              disabled={row.is_primary_admin || !isPermissionDirty(row)}
              onClick={() => void savePermissions(row)}
            >
              保存权限
            </Button>
            <Button
              icon={<KeyOutlined />}
              loading={passwordAccountId === row.id}
              onClick={() => setPasswordModal({ open: true, account: row, value: "" })}
            >
              重置密码
            </Button>
          </Space>
        ),
      },
    ];
  }, [auth?.accountId, draftPermissions, modules, passwordAccountId, savingAccountId, sharedUsername]);

  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <Card className="hero-card">
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <Title level={3} style={{ margin: 0 }}>
            账号权限管理
          </Title>
          <Text type="secondary">主账号可在此新建子账号、重置密码，并按板块勾选每个账号的可访问范围。</Text>
          <Descriptions column={{ xs: 1, md: 2, xl: 4 }} bordered size="small">
            <Descriptions.Item label="固定登录用户名">{sharedUsername || "-"}</Descriptions.Item>
            <Descriptions.Item label="当前管理员">{auth?.name || auth?.username || "-"}</Descriptions.Item>
            <Descriptions.Item label="模块数量">{modules.length}</Descriptions.Item>
            <Descriptions.Item label="账号数量">{accounts.length}</Descriptions.Item>
          </Descriptions>
        </Space>
      </Card>

      <Card
        title="权限矩阵"
        extra={
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadAccounts()} loading={loading}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<UserAddOutlined />}
              onClick={() => {
                setDrawerOpen(true);
                setNewAccountName("");
                setNewAccountPassword("");
                setNewAccountPermissions([]);
              }}
            >
              新建子账号
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="主账号权限固定为全开"
            description="主账号用于系统兜底，不支持在此取消管理员身份或勾空全部权限。子账号支持勾空，此时仍可登录，但只会进入无权限提示页。"
          />
          <Table
            rowKey={(row) => row.id}
            className="app-compact-table"
            columns={columns}
            dataSource={accounts}
            loading={loading}
            pagination={false}
            size="small"
            scroll={{ x: "max-content" }}
          />
        </Space>
      </Card>

      <Drawer
        open={drawerOpen}
        width={420}
        title="新建子账号"
        destroyOnClose
        onClose={() => setDrawerOpen(false)}
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="warning"
            showIcon
            message="所有子账号共用同一个登录用户名"
            description="子账号通过不同密码和显示名区分。创建完成后，页面上展示的是显示名。"
          />
          <Input addonBefore="固定登录名" value={sharedUsername} disabled />
          <Input
            addonBefore="显示名"
            value={newAccountName}
            maxLength={40}
            placeholder="例如：运营A"
            onChange={(event) => setNewAccountName(event.target.value)}
          />
          <Input.Password
            addonBefore="密码"
            value={newAccountPassword}
            placeholder="请输入子账号密码"
            onChange={(event) => setNewAccountPassword(event.target.value)}
          />
          <Card size="small" title="板块权限">
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              {modules.map((module) => (
                <Checkbox
                  key={module.key}
                  checked={newAccountPermissions.includes(module.key)}
                  onChange={(event) => {
                    const next = new Set(newAccountPermissions);
                    if (event.target.checked) {
                      next.add(module.key);
                    } else {
                      next.delete(module.key);
                    }
                    setNewAccountPermissions(sortPermissions(Array.from(next), modules));
                  }}
                >
                  {module.label}
                </Checkbox>
              ))}
            </Space>
          </Card>
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => void createAccount()} loading={loading}>
              创建子账号
            </Button>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
          </Space>
        </Space>
      </Drawer>

      <Modal
        open={passwordModal.open}
        title={passwordModal.account ? `重置密码：${passwordModal.account.name}` : "重置密码"}
        destroyOnHidden
        confirmLoading={!!passwordAccountId}
        okText="保存新密码"
        onCancel={() => setPasswordModal({ open: false, account: null, value: "" })}
        onOk={() => void savePassword()}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {passwordModal.account?.is_primary_admin ? (
            <Alert type="warning" showIcon message="你正在重置主账号密码" />
          ) : (
            <Alert type="info" showIcon message="保存后，该账号下次登录将使用新密码" />
          )}
          <Input.Password
            placeholder="请输入新的登录密码"
            value={passwordModal.value}
            onChange={(event) =>
              setPasswordModal((prev) => ({
                ...prev,
                value: event.target.value,
              }))
            }
          />
        </Space>
      </Modal>
    </Space>
  );
}
