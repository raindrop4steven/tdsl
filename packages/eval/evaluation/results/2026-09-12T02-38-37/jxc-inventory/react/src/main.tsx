import React from 'react';
import ReactDOM from 'react-dom';
import 'antd/dist/reset.css';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

declare const __REPORT_URL__: string;
// 运行时错误回流 agent（M10）：vite dev 注入上报地址；自动采集未捕获异常/拒绝与 HTTP ≥400
const REPORT_URL = typeof __REPORT_URL__ === 'string' ? __REPORT_URL__ : '';
function report(payload: Record<string, unknown>): void {
  if (!REPORT_URL) return;
  window.fetch(REPORT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {});
}
window.addEventListener('error', (e) => report({ kind: 'error', message: String(e.message) }));
window.addEventListener('unhandledrejection', (e) => report({ kind: 'rejection', message: String(e.reason) }));
const origFetch = window.fetch.bind(window);
window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
  const res = await origFetch(...args);
  if (res.status >= 400) report({ kind: 'http', message: `HTTP ${res.status} ${String(args[0])}` });
  return res;
};

ReactDOM.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
  document.getElementById('root'),
);
