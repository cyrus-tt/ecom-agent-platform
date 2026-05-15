import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const gatewayTarget = process.env.VITE_GATEWAY_TARGET || "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: gatewayTarget,
        changeOrigin: true,
      },
      "/login": {
        target: gatewayTarget,
        changeOrigin: true,
      },
      "/logout": {
        target: gatewayTarget,
        changeOrigin: true,
      },
    },
  },
});
