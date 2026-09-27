import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 开发代理：/api → Django 后端（含 SSE）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
