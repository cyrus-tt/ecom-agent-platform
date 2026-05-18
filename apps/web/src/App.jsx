import {
  BarChartOutlined,
  FileTextOutlined,
  FundProjectionScreenOutlined,
  HomeOutlined,
  InboxOutlined,
  LineChartOutlined,
  RobotOutlined,
  SettingOutlined,
  ShopOutlined,
  SwapOutlined,
  TableOutlined,
  TeamOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { Alert, Button, Input, Layout, Menu, Modal, Space, Spin, Tag, Typography, message } from "antd";
import { Suspense, lazy, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import http from "./api/http";
import { useAuth } from "./auth/AuthContext";
import ChangePasswordModal from "./components/ChangePasswordModal";
import {
  ADMIN_ACCOUNTS_ROUTE,
  ADMIN_USAGE_ROUTE,
  APP_MODULES,
  NO_ACCESS_ROUTE,
  getPreferredRoute,
  resolveSelectedMenu,
} from "./auth/modules";
import AnalysisPage from "./pages/AnalysisPage";
import ArrivalPage from "./pages/ArrivalPage";
import AdminAccountsPage from "./pages/AdminAccountsPage";
import AdminUsagePage from "./pages/AdminUsagePage";
import ChannelDashboardPage from "./pages/ChannelDashboardPage";
import DailyReportPage from "./pages/DailyReportPage";
import DashboardPage from "./pages/DashboardPage";
import DispatchPage from "./pages/DispatchPage";
import BiPage from "./pages/BiPage";
import NoAccessPage from "./pages/NoAccessPage";
import OutletAssortmentPage from "./pages/OutletAssortmentPage";
import PortalPage from "./pages/PortalPage";
import ToolsPage from "./pages/ToolsPage";

const AgentDashboardPage = lazy(() => import("./pages/AgentDashboardPage"));

const { Header, Content } = Layout;
const { Text } = Typography;

const MODULE_ICON_MAP = {
  portal: <HomeOutlined />,
  report_daily: <TableOutlined />,
  outlet_assortment: <ShopOutlined />,
  arrival: <InboxOutlined />,
  dashboard: <BarChartOutlined />,
  channel_dashboard: <ShopOutlined />,
  analysis: <FileTextOutlined />,
  bi: <FundProjectionScreenOutlined />,
  dispatch: <SwapOutlined />,
  tools: <ToolOutlined />,
  agent_dashboard: <RobotOutlined />,
};

function LoadingScreen() {
  return (
    <div className="settings-loading">
      <Space direction="vertical" align="center" size={10}>
        <Spin />
        <Text type="secondary">正在加载账号信息...</Text>
      </Space>
    </div>
  );
}

function GuardedElement({ children, permission, adminOnly = false }) {
  const location = useLocation();
  const { auth, loading, hasPermission, isAdmin } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }
  if (!auth) {
    return null;
  }

  const allowed = adminOnly ? isAdmin : !permission || hasPermission(permission);
  if (!allowed) {
    const fallbackRoute = getPreferredRoute(auth);
    const nextRoute = fallbackRoute === location.pathname ? NO_ACCESS_ROUTE : fallbackRoute;
    return <Navigate to={nextRoute} replace />;
  }

  return children;
}

function AppShell() {
  const location = useLocation();
  const { auth, loading, isAdmin, hasPermission, preferredRoute, refreshAuth } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [aiSettings, setAiSettings] = useState(null);
  const [deepseekKey, setDeepseekKey] = useState("");
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const selected = resolveSelectedMenu(location.pathname);

  useEffect(() => {
    if (!loading) {
      void refreshAuth({ silent: true });
    }
  }, [loading, location.pathname]);

  async function loadAiSettings() {
    setSettingsLoading(true);
    try {
      const resp = await http.get("/api/settings/ai", {
        params: { _t: Date.now() },
      });
      setAiSettings(resp.data?.settings || null);
    } catch (err) {
      message.error(err?.response?.data?.message || err.message || "读取 AI 设置失败");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function openSettings() {
    setSettingsOpen(true);
    setDeepseekKey("");
    await loadAiSettings();
  }

  async function saveDeepseekKey() {
    const apiKey = String(deepseekKey || "").trim();
    if (!apiKey) {
      message.error("请先填写 DeepSeek API Key");
      return;
    }
    setSettingsSaving(true);
    try {
      const resp = await http.post("/api/settings/ai/deepseek-key", { api_key: apiKey });
      setAiSettings(resp.data?.settings || null);
      setDeepseekKey("");
      message.success("DeepSeek Key 已写入当前网关进程");
    } catch (err) {
      message.error(err?.response?.data?.message || err.message || "保存 DeepSeek Key 失败");
    } finally {
      setSettingsSaving(false);
    }
  }

  async function clearDeepseekKey() {
    setSettingsSaving(true);
    try {
      const resp = await http.delete("/api/settings/ai/deepseek-key");
      setAiSettings(resp.data?.settings || null);
      setDeepseekKey("");
      message.success("当前会话中的 DeepSeek Key 已清除");
    } catch (err) {
      message.error(err?.response?.data?.message || err.message || "清除 DeepSeek Key 失败");
    } finally {
      setSettingsSaving(false);
    }
  }

  const menuItems = APP_MODULES.filter((item) => hasPermission(item.key)).map((item) => ({
    key: item.menuKey,
    icon: MODULE_ICON_MAP[item.key],
    label: <Link to={item.path}>{item.label}</Link>,
  }));

  if (isAdmin) {
    menuItems.push({
      key: ADMIN_ACCOUNTS_ROUTE,
      icon: <TeamOutlined />,
      label: <Link to={ADMIN_ACCOUNTS_ROUTE}>账号权限</Link>,
    });
    menuItems.push({
      key: ADMIN_USAGE_ROUTE,
      icon: <LineChartOutlined />,
      label: <Link to={ADMIN_USAGE_ROUTE}>用量统计</Link>,
    });
  }

  if (loading) {
    return (
      <Layout className="app-root">
        <Header className="app-header">
          <div className="brand">ANTA COMMERCE INTELLIGENCE</div>
        </Header>
        <Content className="app-content">
          <LoadingScreen />
        </Content>
      </Layout>
    );
  }

  return (
    <Layout className="app-root">
      <Header className="app-header">
        <div className="brand">ANTA COMMERCE INTELLIGENCE</div>
        <Menu mode="horizontal" theme="dark" selectedKeys={selected ? [selected] : []} items={menuItems} />
        <div className="app-header-actions">
          <Space wrap>
            <div className="app-user-badge">
              <span>{auth?.name || auth?.username || "-"}</span>
              {isAdmin ? <Tag color="gold">管理员</Tag> : null}
            </div>
            {isAdmin ? (
              <Button className="app-header-settings-btn" icon={<SettingOutlined />} onClick={openSettings}>
                AI 设置
              </Button>
            ) : null}
            <Button className="app-header-change-password-btn" onClick={() => setChangePasswordOpen(true)}>
              修改密码
            </Button>
            <Button className="app-header-logout-btn" href="/logout">
              退出
            </Button>
          </Space>
        </div>
      </Header>
      <ChangePasswordModal open={changePasswordOpen} onCancel={() => setChangePasswordOpen(false)} />

      <Content className="app-content">
        <Routes>
          <Route
            path="/"
            element={
              <GuardedElement permission="portal">
                <PortalPage />
              </GuardedElement>
            }
          />
          <Route
            path="/report-daily"
            element={
              <GuardedElement permission="report_daily">
                <DailyReportPage />
              </GuardedElement>
            }
          />
          <Route
            path="/outlet-assortment"
            element={
              <GuardedElement permission="outlet_assortment">
                <OutletAssortmentPage />
              </GuardedElement>
            }
          />
          <Route
            path="/arrival"
            element={
              <GuardedElement permission="arrival">
                <ArrivalPage />
              </GuardedElement>
            }
          />
          <Route
            path="/arrival/*"
            element={
              <GuardedElement permission="arrival">
                <ArrivalPage />
              </GuardedElement>
            }
          />
          <Route
            path="/dashboard"
            element={
              <GuardedElement permission="dashboard">
                <DashboardPage />
              </GuardedElement>
            }
          />
          <Route
            path="/channel-dashboard"
            element={
              <GuardedElement permission="channel_dashboard">
                <ChannelDashboardPage />
              </GuardedElement>
            }
          />
          <Route
            path="/analysis"
            element={
              <GuardedElement permission="analysis">
                <AnalysisPage />
              </GuardedElement>
            }
          />
          <Route
            path="/bi"
            element={
              <GuardedElement permission="bi">
                <BiPage />
              </GuardedElement>
            }
          />
          <Route
            path="/dispatch"
            element={
              <GuardedElement permission="dispatch">
                <DispatchPage />
              </GuardedElement>
            }
          />
          <Route
            path="/tools"
            element={
              <GuardedElement permission="tools">
                <ToolsPage />
              </GuardedElement>
            }
          />
          <Route
            path="/agent-dashboard"
            element={
              <GuardedElement permission="agent_dashboard">
                <Suspense fallback={<Spin size="large" style={{ display: "flex", justifyContent: "center", marginTop: 120 }} />}>
                  <AgentDashboardPage />
                </Suspense>
              </GuardedElement>
            }
          />
          <Route
            path={ADMIN_ACCOUNTS_ROUTE}
            element={
              <GuardedElement adminOnly>
                <AdminAccountsPage />
              </GuardedElement>
            }
          />
          <Route
            path={ADMIN_USAGE_ROUTE}
            element={
              <GuardedElement adminOnly>
                <AdminUsagePage />
              </GuardedElement>
            }
          />
          <Route path={NO_ACCESS_ROUTE} element={<NoAccessPage />} />
          <Route path="*" element={<Navigate to={preferredRoute || NO_ACCESS_ROUTE} replace />} />
        </Routes>
      </Content>

      <Modal
        open={settingsOpen}
        title="DeepSeek Key 设置"
        destroyOnHidden
        onCancel={() => {
          setSettingsOpen(false);
          setDeepseekKey("");
        }}
        footer={[
          <Button
            key="clear"
            danger
            onClick={() => void clearDeepseekKey()}
            loading={settingsSaving}
            disabled={settingsLoading || aiSettings?.source !== "runtime"}
          >
            清除本次会话 Key
          </Button>,
          <Button key="cancel" onClick={() => setSettingsOpen(false)} disabled={settingsSaving}>
            关闭
          </Button>,
          <Button key="save" type="primary" onClick={() => void saveDeepseekKey()} loading={settingsSaving}>
            保存并使用
          </Button>,
        ]}
      >
        {settingsLoading ? (
          <LoadingScreen />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Alert
              type={aiSettings?.configured ? "success" : "warning"}
              showIcon
              message={aiSettings?.configured ? "DeepSeek Key 已配置" : "DeepSeek Key 未配置"}
              description={
                <Space direction="vertical" size={6}>
                  <Text>
                    当前来源：
                    <Tag color={aiSettings?.source === "runtime" ? "blue" : aiSettings?.source === "environment" ? "green" : "default"}>
                      {aiSettings?.source === "runtime"
                        ? "当前会话"
                        : aiSettings?.source === "environment"
                          ? "环境变量"
                          : "未配置"}
                    </Tag>
                  </Text>
                  <Text>Base URL：{aiSettings?.base_url || "-"}</Text>
                  <Text>Model：{aiSettings?.model || "-"}</Text>
                  <Text type="secondary">当前实现仅保存在网关进程内存中，网关重启后需要重新填写。</Text>
                </Space>
              }
            />

            <div>
              <Text strong>填写 DeepSeek API Key</Text>
              <Input.Password
                value={deepseekKey}
                visibilityToggle={false}
                autoComplete="new-password"
                placeholder="sk-..."
                onChange={(event) => setDeepseekKey(event.target.value)}
                onCopy={(event) => event.preventDefault()}
                onCut={(event) => event.preventDefault()}
                onContextMenu={(event) => event.preventDefault()}
              />
            </div>
          </Space>
        )}
      </Modal>
    </Layout>
  );
}

export default function App() {
  return <AppShell />;
}
