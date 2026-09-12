import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// M10 运行回路：/api 代理到同会话后端（BACKEND_PORT 由 runner 注入）；
// __REPORT_URL__ 由 runner 注入（前端运行时错误回流 agent 服务）
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.BACKEND_PORT ?? 8080}`,
        changeOrigin: true,
      },
    },
  },
  define: {
    __REPORT_URL__: JSON.stringify(process.env.TDSL_REPORT_URL ?? ''),
  },
});
