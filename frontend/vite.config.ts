import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 开发代理：
//   /api    → Django（业务接口，含 SSE）
//   /admin  → Django Admin 后台（含登录与后续跳转）
//   /static → Django Admin 的 CSS/JS 静态资源
// 不代理 /admin 的话，Vite 会把它当 SPA 路由返回 index.html，
// 于是前端路由匹配不到而回退到主页。
const BACKEND = "http://127.0.0.1:8000";

// 开发与预览都要代理，否则 `yarn preview` 起来的产物所有 /api 请求都会 404
const proxy = {
  "/api": { target: BACKEND, changeOrigin: true },
  "/admin": { target: BACKEND, changeOrigin: true },
  "/static": { target: BACKEND, changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy,
  },
  preview: {
    port: 4173,
    proxy,
  },
});
