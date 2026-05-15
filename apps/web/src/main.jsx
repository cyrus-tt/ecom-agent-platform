import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { StyleProvider } from "@ant-design/cssinjs";
import "antd/dist/reset.css";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import DispatchConfirmPage from "./pages/DispatchConfirmPage";
import "./styles.css";

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
      {isPublicConfirmPage ? (
        <DispatchConfirmPage />
      ) : (
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      )}
    </StyleProvider>
  </React.StrictMode>
);
