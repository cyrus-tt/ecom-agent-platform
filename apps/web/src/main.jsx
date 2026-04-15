import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "antd/dist/reset.css";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import DispatchConfirmPage from "./pages/DispatchConfirmPage";
import "./styles.css";

const isPublicConfirmPage = /^\/dispatch\/confirm\//.test(window.location.pathname);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isPublicConfirmPage ? (
      <DispatchConfirmPage />
    ) : (
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    )}
  </React.StrictMode>
);
