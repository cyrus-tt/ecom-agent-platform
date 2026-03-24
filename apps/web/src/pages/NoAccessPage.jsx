import { LockOutlined } from "@ant-design/icons";
import { Button, Card, Space, Typography } from "antd";
import { useAuth } from "../auth/AuthContext";

const { Title, Text } = Typography;

export default function NoAccessPage() {
  const { auth } = useAuth();

  return (
    <div className="empty-page-shell">
      <Card className="hero-card empty-page-card">
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <LockOutlined className="empty-page-icon" />
          <Title level={3} style={{ margin: 0 }}>
            当前账号没有可用板块权限
          </Title>
          <Text type="secondary">
            {auth?.name || auth?.username || "当前账号"} 已登录，但没有被分配任何业务板块。请使用管理员账号在账号权限面板中勾选可访问模块后重试。
          </Text>
          <Space wrap>
            <Button type="primary" href="/logout">
              退出登录
            </Button>
          </Space>
        </Space>
      </Card>
    </div>
  );
}
