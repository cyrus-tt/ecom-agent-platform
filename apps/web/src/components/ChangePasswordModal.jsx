import { useState } from "react";
import { Alert, Form, Input, Modal, message } from "antd";
import http from "../api/http";

export default function ChangePasswordModal({ open, onCancel }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [reasons, setReasons] = useState([]);

  function handleCancel() {
    form.resetFields();
    setReasons([]);
    onCancel?.();
  }

  async function handleSubmit() {
    let values;
    try {
      values = await form.validateFields();
    } catch (_err) {
      return; // 表单内置校验已展示错误
    }

    setLoading(true);
    setReasons([]);
    try {
      const resp = await http.post("/api/auth/me/password", {
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });
      message.success(resp?.data?.message || "密码已更新，请重新登录");
      // 后端已清服务端 session + 清 cookie；前端跳登录页（保留 next 不必要，让用户重新选）
      setTimeout(() => {
        window.location.href = "/login";
      }, 1200);
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data || {};
      if (status === 422 && Array.isArray(data.reasons) && data.reasons.length > 0) {
        setReasons(data.reasons);
      } else if (status === 400) {
        message.error(data.message || "旧密码不正确");
      } else {
        message.error(data.message || err?.message || "修改密码失败，请稍后重试");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      title="修改密码"
      open={open}
      onCancel={handleCancel}
      onOk={handleSubmit}
      okText="确定"
      cancelText="取消"
      confirmLoading={loading}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="oldPassword"
          label="旧密码"
          rules={[{ required: true, message: "请输入旧密码" }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[{ required: true, message: "请输入新密码" }]}
          extra="至少 8 位，需含小写字母，不能是常见弱口令"
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirmNewPassword"
          label="再次输入新密码"
          dependencies={["newPassword"]}
          rules={[
            { required: true, message: "请再次输入新密码" },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue("newPassword") === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error("两次输入的新密码不一致"));
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
      {reasons.length > 0 ? (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 12 }}
          message="新密码不符合策略要求"
          description={
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          }
        />
      ) : null}
    </Modal>
  );
}
