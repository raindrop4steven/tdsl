/**
 * M9 服务入口：静态页（聊天面板）+ WebSocket 转发 pi 事件流。
 * 启动：npm run server（8787）；模型配置见 docs/dev/23（TDSL_LLM_BASE_URL/MODEL/API_KEY，或 pi 默认 provider）。
 */
import { createServer } from 'node:http';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { spawn } from 'node:child_process';
import kill from 'tree-kill';
import { exportZip } from './export';
import { appendLog, logTail } from './runner';
import { SessionTable, type SessionEntry } from './sessions';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TDSL_SERVER_PORT ?? 8787);

const table = new SessionTable(undefined, {
  spawnFn: (cmd, args, cwd, env) =>
    spawn(cmd, args, { cwd, env: { ...process.env, ...env }, shell: true, stdio: ['ignore', 'pipe', 'pipe'] }),
  killFn: (pid) => kill(pid),
  reportUrlBase: `http://localhost:${PORT}`,
});

/** 会话 id → 合法 Java 包名（与 sessions.ts appNameOf 同规则） */
function appNameOf(id: string): string {
  const name = id.replace(/[^A-Za-z0-9_]/g, '');
  return /^[A-Za-z]/.test(name) ? name : 'app' + name;
}

/** 装配 HTTP + WS */
export function startServer(opts?: { table?: SessionTable }): void {
  const sessions = opts?.table ?? table;
  const server = createServer((req, res) => {
    // 静态页（聊天面板，无构建链：原生 HTML+JS）
    if (req.url === '/' || req.url === '/index.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(readFileSync(join(ROOT, '..', 'public', 'index.html'), 'utf8'));
      return;
    }
    if (req.url === '/healthz') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, sessions: sessions.list() }));
      return;
    }
    // 导出产物：/api/export/<sessionId>/<java|react|all> → zip 下载
    const exportMatch = /^\/api\/export\/([A-Za-z0-9]+)\/(java|react|all)$/.exec(req.url ?? '');
    if (exportMatch && req.method === 'GET') {
      void sessions
        .get(exportMatch[1])
        .then((entry) => {
          if (!entry) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'unknown session' }));
            return;
          }
          const target = exportMatch[2] as 'java' | 'react' | 'all';
          if (target !== 'all') {
            if (!entry.ws.hasGenerated(target)) {
              res.statusCode = 409;
              res.end(JSON.stringify({ error: `产物尚未生成（先让 agent 调用 generate_code）: ${target}` }));
              return;
            }
          } else if (!entry.ws.hasGenerated('java') && !entry.ws.hasGenerated('react')) {
            res.statusCode = 409;
            res.end(JSON.stringify({ error: '产物尚未生成（先让 agent 调用 generate_code）' }));
            return;
          }
          return exportZip(entry.ws, target).then((buf) => {
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${appNameOf(entry.id)}-${target}.zip"`);
            res.end(buf);
          });
        })
        .catch((err) => {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        });
      return;
    }
    // 产物状态：/api/generated/<sessionId> → {java,react} 是否已落盘（页面恢复按钮态）
    const statusMatch = /^\/api\/generated\/([A-Za-z0-9]+)$/.exec(req.url ?? '');
    if (statusMatch && req.method === 'GET') {
      void sessions
        .get(statusMatch[1])
        .then((entry) => {
          if (!entry) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'unknown session' }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ java: entry.ws.hasGenerated('java'), react: entry.ws.hasGenerated('react') }));
        })
        .catch((err) => {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        });
      return;
    }
    // 运行状态（页面轮询）：/api/run-status/<sessionId>
    const runMatch = /^\/api\/run-status\/([A-Za-z0-9]+)$/.exec(req.url ?? '');
    if (runMatch && req.method === 'GET') {
      void sessions
        .get(runMatch[1])
        .then((entry) => {
          if (!entry) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'unknown session' }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(entry.runner.status()));
        })
        .catch((err) => {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        });
      return;
    }
    // 前端运行时错误回流（M10）：生成页 reporter → 沙箱 logs/client.log → agent 经 run_app logs 检索
    const errMatch = /^\/api\/client-error\?sessionId=([A-Za-z0-9]+)$/.exec(req.url ?? '');
    if (errMatch && req.method === 'POST') {
      let body = '';
      req.on('data', (c: Buffer) => (body += String(c)));
      req.on('end', () => {
        void sessions
          .get(errMatch[1])
          .then((entry0) => {
            if (!entry0) {
              res.end('unknown session');
              return;
            }
            appendFileSync(join(entry0.ws.root, 'logs', 'client.log'), `[client-error] ${body}\n`);
            res.end('ok');
          })
          .catch(() => res.end('unknown session'));
      });
      return;
    }
    // agent 诊断日志（调试面板轮询）：/api/agent-log/<sessionId> → logs/agent.log 尾部
    const logMatch = /^\/api\/agent-log\/([A-Za-z0-9]+)$/.exec(req.url ?? '');
    if (logMatch && req.method === 'GET') {
      void sessions
        .get(logMatch[1])
        .then((entry) => {
          if (!entry) {
            res.statusCode = 404;
            res.end('unknown session');
            return;
          }
          const { tail } = logTail(join(entry.ws.root, 'logs', 'agent.log'), 200);
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(tail || '(暂无日志)');
        })
        .catch(() => {
          res.statusCode = 500;
          res.end('log error');
        });
      return;
    }
    // 创建会话（注入错误回流地址：agent 服务端口 + 会话 id）
    if (req.url === '/api/session' && req.method === 'POST') {
      void sessions
        .create({ reportUrlBase: `http://localhost:${PORT}` })
        .then((e) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ sessionId: e.id }));
        })
        .catch((err) => {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        });
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', (socket, req) => {
    const sessionId = new URL(req.url ?? '/', 'http://x').searchParams.get('sessionId');
    if (!sessionId) {
      socket.close(4000, 'sessionId required');
      return;
    }
    void sessions.get(sessionId).then((entry) => {
      if (!entry) {
        socket.close(4001, 'unknown session');
        return;
      }
      bindSession(socket, entry);
      socket.send(JSON.stringify({ type: 'ready', sessionId }));
    });
  });

  server.listen(PORT, () => {
    console.log(`\n✓ TDSL Agent Server: http://localhost:${PORT}（模型: ${process.env.TDSL_LLM_MODEL ?? 'pi 默认'}）`);
  });
}

/** pi 事件流 → WS 下发；用户消息 → session.prompt */
function bindSession(socket: { send: (data: string) => void; on: (ev: string, fn: (data: string) => void) => void }, entry: SessionEntry): void {
  const unsub = entry.session.subscribe((event) => {
    // 只转发浏览器关心的轻量事件（完整事件流量大）
    const slim = slimEvent(event);
    if (slim) socket.send(JSON.stringify(slim));
  });

  socket.on('message', (raw: string) => {
    void (async () => {
      let msg: { type?: string; text?: string };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === 'prompt' && msg.text) {
        try {
          const ts = new Date().toISOString().slice(11, 19);
          const line = `user prompt: ${msg.text.slice(0, 120)}`;
          console.log(`[agent:${entry.id}] ${ts} ${line}`);
          appendLog(join(entry.ws.root, 'logs', 'agent.log'), `[${ts}] ${line}\n`);
          await entry.session.prompt(msg.text);
        } catch (err) {
          // 模型调用失败（如 key 无效/端点不可达）不能静默吞掉，必须回流到浏览器
          const message = err instanceof Error ? err.message : String(err);
          console.error('[prompt 失败]', message);
          socket.send(JSON.stringify({ type: 'error', message: `模型调用失败: ${message}` }));
        }
      }
    })();
  });
}

type SlimEvent = { type: string; [k: string]: unknown } | null;

/** 事件瘦身：流式文本增量 / 工具调用 / 工具结果 / 完成 */
function slimEvent(event: AgentSessionEvent): SlimEvent {
  switch (event.type) {
    case 'message_update':
      if (event.assistantMessageEvent.type === 'text_delta') {
        return { type: 'delta', text: event.assistantMessageEvent.delta };
      }
      return null;
    case 'message_start':
    case 'message_end':
      return { type: event.type, role: (event as { message?: { role?: string } }).message?.role };
    case 'tool_execution_start':
      return { type: 'tool_start', tool: (event as { toolName?: string }).toolName, args: (event as { args?: unknown }).args };
    case 'tool_execution_end':
      return { type: 'tool_end', tool: (event as { toolName?: string }).toolName, result: (event as { result?: unknown }).result };
    case 'auto_retry_start':
      return { type: 'error', message: `模型调用失败，自动重试 ${(event as { attempt?: number }).attempt}/${(event as { maxAttempts?: number }).maxAttempts}：${(event as { errorMessage?: string }).errorMessage}` };
    case 'agent_start':
    case 'agent_end':
      return { type: event.type };
    default:
      return null;
  }
}

// 直接运行（tsx src/index.ts）
if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
  startServer();
}
