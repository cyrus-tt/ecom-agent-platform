import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App as AntdApp } from "antd";
import { StyleProvider } from "@ant-design/cssinjs";
import "antd/dist/reset.css";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import DispatchConfirmPage from "./pages/DispatchConfirmPage";
import "./styles.css";

/**
 * 注意（V3 起）：
 *  - AntD 5 推荐用 `<App>` 包裹整棵树，让 `App.useApp()` 能拿到 message/notification 实例
 *  - 公开页 DispatchConfirmPage 走旁路（不进 BrowserRouter / AuthProvider），
 *    但同样必须包 AntdApp，否则它的 message.error 不会弹 toast
 */

const isPublicConfirmPage = /^\/dispatch\/confirm\//.test(window.location.pathname);
const supportsWhereSelector =
  typeof window !== "undefined" &&
  typeof window.CSS !== "undefined" &&
  typeof window.CSS.supports === "function" &&
  window.CSS.supports("selector(:where(*))");
const styleHashPriority = supportsWhereSelector ? "low" : "high";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <StyleProvider hashPriority={styleHashPriority}>
      <AntdApp>
        {isPublicConfirmPage ? (
          <DispatchConfirmPage />
        ) : (
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        )}
      </AntdApp>
    </StyleProvider>
  </React.StrictMode>
);
