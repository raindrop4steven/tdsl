/**
 * 会话装配（M9）：id → { AgentSession, Workspace }。
 * pi 承担 turn loop / 上下文压缩 / 会话持久化；本层只做沙箱 + 工具 + 提示词装配与事件转发。
 */
import { mkdtempSync, mkdirSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  defineTool as piDefineTool,
  type AgentSession,
  type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';
import { EXAMPLES } from '@tdsl/llm';
import { AppRunner, MAX_RUNNING_SESSIONS, appendLog } from './runner';
import { buildTools, systemPrompt } from './tools';
import { Workspace } from './workspace';

export interface SessionEntry {
  id: string;
  session: AgentSession;
  ws: Workspace;
  runner: AppRunner;
}

export interface SpawnOptions {
  /** 进程拉起/终止注入（测试用假实现；index.ts 装配真实 spawn + tree-kill） */
  spawnFn?: (cmd: string, args: string[], cwd: string, env: Record<string, string>) => import('node:child_process').ChildProcess;
  killFn?: (pid: number) => void;
  /** agent 服务基址（错误回流 URL 前缀），缺省取入口装配时的 PORT */
  reportUrlBase?: string;
}

export class SessionTable {
  private sessions = new Map<string, Promise<SessionEntry>>();
  private counter = 0;
  private readonly baseDir: string;
  private readonly spawnOpts: SpawnOptions;

  /** baseDir 缺省 = 系统临时目录（测试/演示免清理；跨重启恢复需显式传固定目录，如 packages/server/.sessions） */
  constructor(baseDir?: string, spawnOpts?: SpawnOptions) {
    this.baseDir = baseDir ?? mkdtempSync(join(tmpdir(), 'tdsl-agent-'));
    // 会话编号续用：扫已存在的 s<N> 目录，避免重启后新会话与磁盘上旧沙箱撞名
    try {
      const seqs = existsSync(this.baseDir)
        ? readdirSync(this.baseDir)
            .filter((d) => /^s\d+$/.test(d))
            .map((d) => Number.parseInt(d.slice(1), 10))
        : [];
      this.counter = seqs.length > 0 ? Math.max(...seqs) : 0;
    } catch {
      this.counter = 0;
    }
    this.spawnOpts = spawnOpts ?? {};
  }

  get base(): string {
    return this.baseDir;
  }

  /** 创建会话（异步装配 pi）；同 id 幂等；全局并发上限保护 */
  create(opts?: { reportUrlBase?: string }): Promise<SessionEntry> {
    if (this.sessions.size >= MAX_RUNNING_SESSIONS) {
      return Promise.reject(new Error(`并发会话已达上限（${MAX_RUNNING_SESSIONS}），请先结束已有会话`));
    }
    this.counter++;
    const id = `s${this.counter}`;
    const ws = this.newWorkspace(id);
    // runner：sessionSeq = counter-1（s1 → 8080/5173，s2 → 8081/5174…）；错误回流地址由入口注入
    const reportUrl = opts?.reportUrlBase ?? this.spawnOpts.reportUrlBase
      ? `${(opts?.reportUrlBase ?? this.spawnOpts.reportUrlBase)}/api/client-error?sessionId=${id}`
      : process.env.TDSL_AGENT_REPORT_URL;
    const runner = new AppRunner(
      join(ws.root, 'generated', 'java'),
      join(ws.root, 'generated', 'react'),
      join(ws.root, 'logs'),
      this.counter - 1,
      { reportUrl, spawnFn: this.spawnOpts.spawnFn, killFn: this.spawnOpts.killFn },
    );
    const entry = createSession({ id, ws, modelsJson: buildModelsJson(), runner });
    this.sessions.set(id, entry);
    return entry;
  }

  async get(id: string): Promise<SessionEntry | undefined> {
    return this.sessions.get(id);
  }

  list(): string[] {
    return [...this.sessions.keys()];
  }

  private newWorkspace(id: string): Workspace {
    const dir = join(this.baseDir, id);
    mkdirSync(dir, { recursive: true });
    const ws = new Workspace(dir);
    ws.ensure();
    injectExamples(ws);
    return ws;
  }

  /** 恢复已有会话（刷新/服务重启后续用）：沙箱目录还在 → 以该目录重建（文件即状态；聊天历史不保留） */
  async restore(id: string, opts?: { reportUrlBase?: string }): Promise<SessionEntry> {
    const existing = await this.get(id);
    if (existing) return existing;
    const dir = join(this.baseDir, id);
    if (!existsSync(join(dir, 'tdsl'))) {
      return Promise.reject(new Error(`会话 ${id} 不存在或已失效`));
    }
    const ws = new Workspace(dir);
    ws.ensure();
    const seq = Math.max(0, (Number.parseInt(id.replace(/\D/g, ''), 10) || 1) - 1);
    const reportUrl = (opts?.reportUrlBase ?? this.spawnOpts.reportUrlBase)
      ? `${(opts?.reportUrlBase ?? this.spawnOpts.reportUrlBase)}/api/client-error?sessionId=${id}`
      : process.env.TDSL_AGENT_REPORT_URL;
    const runner = new AppRunner(
      join(ws.root, 'generated', 'java'),
      join(ws.root, 'generated', 'react'),
      join(ws.root, 'logs'),
      seq,
      { reportUrl, spawnFn: this.spawnOpts.spawnFn, killFn: this.spawnOpts.killFn },
    );
    const entry = createSession({ id, ws, modelsJson: buildModelsJson(), runner });
    this.sessions.set(id, entry);
    return entry;
  }

  disposeAll(): void {
    for (const [id, promise] of this.sessions) {
      void promise
        .then((e) => {
          e.session.dispose();
          e.runner.down();
          e.ws.dispose();
        })
        .catch(() => {
          /* 会话未建完成即清理 */
        });
      this.sessions.delete(id);
    }
  }
}

/** 环境变量 → pi models.json（OpenAI 兼容端点，含 Ollama/vLLM 本地兜底；未配置返回 null=用 pi 默认 provider） */
export function buildModelsJson(env: NodeJS.ProcessEnv = process.env): string | null {
  const baseUrl = env.TDSL_LLM_BASE_URL;
  const model = env.TDSL_LLM_MODEL;
  if (!baseUrl || !model) return null;
  const key = env.TDSL_LLM_API_KEY ?? 'placeholder';
  // 兼容性开关透传（pi 省略时按“标准 OpenAI”探测，GLM 等端点需要显式覆盖，如 maxTokensField）；
  // OpenCode Go 等网关要求会话头路由（MissingSessionID），强制开启 session affinity（pi 从 sessionId 生成 x-session-id）
  const compat = { sendSessionAffinityHeaders: true, ...parseCompat(env.TDSL_LLM_COMPAT) };
  return JSON.stringify(
    {
      providers: {
        'tdsl-llm': {
          name: 'tdsl-llm',
          baseUrl,
          api: 'openai-completions',
          apiKey: key,
          models: compat ? [{ id: model, compat }] : [{ id: model }],
        },
      },
    },
    null,
    2,
  );
}

/** TDSL_LLM_COMPAT（JSON 字符串）→ compat 对象；缺失/非法返回 undefined（不阻断启动） */
function parseCompat(raw: string | undefined): Record<string, boolean | string> | undefined {
  if (!raw) return undefined;
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, boolean | string>;
  } catch {
    /* 非法 JSON 忽略，走 pi 默认探测 */
  }
  return undefined;
}

export async function createSession(opts: {
  id: string;
  ws: Workspace;
  runner: AppRunner;
  modelsJson?: string | null;
  onEvent?: (e: AgentSessionEvent) => void;
  onRunnerState?: () => void;
}): Promise<SessionEntry> {
  const { id, ws, runner, modelsJson, onEvent } = opts;

  // auth/models 隔离到服务级临时目录（不污染用户全局 ~/.pi/agent）
  const agentDir = mkdtempSync(join(tmpdir(), 'tdsl-agent-svc-'));
  if (modelsJson) {
    writeFileSync(join(agentDir, 'models.json'), modelsJson, 'utf8');
  }
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: modelsJson ? join(agentDir, 'models.json') : undefined,
  });

  const loader = new DefaultResourceLoader({
    cwd: ws.root,
    agentDir,
    systemPromptOverride: () => systemPrompt(),
    // 不追加全局 APPEND_SYSTEM.md：服务提示词完全由本服务控制
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();

  const tools = buildTools(
    ws,
    appNameOf(id),
    (def) => piDefineTool(def as never) as unknown,
    runner,
    opts.onRunnerState,
  );
  const { session } = await createAgentSession({
    cwd: ws.root,
    resourceLoader: loader,
    modelRuntime,
    sessionManager: SessionManager.inMemory(ws.root),
    tools: ['write_tdsl_files', 'read_tdsl_files', 'compile_tdsl', 'generate_code', 'run_app'],
    // 重试/超时策略：GLM 网关首 token 慢（长系统提示词+思考），默认 10s 级超时会 Request timed out，放宽到 5min
    settingsManager: SettingsManager.inMemory({
      retry: {
        enabled: true,
        maxRetries: 5,
        baseDelayMs: 3000,
        provider: { timeoutMs: 300_000, maxRetries: 0, maxRetryDelayMs: 60_000 },
      },
    }),
    customTools: tools as never,
  });

  const entry: SessionEntry = { id, session, ws, runner };
  if (onEvent) session.subscribe(onEvent);
  // 诊断日志：控制台 + 沙箱 logs/agent.log——模型请求发了没/返回多少/报什么错，一眼可见
  session.subscribe(agentEventLogger(id, ws));
  return entry;
}

/** agent 事件 → 人话日志（控制台 + logs/agent.log） */
function agentEventLogger(id: string, ws: Workspace): (e: AgentSessionEvent) => void {
  const file = join(ws.root, 'logs', 'agent.log');
  const write = (line: string): void => {
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`[agent:${id}] ${ts} ${line}`);
    appendLog(file, `[${ts}] ${line}\n`);
  };
  return (e: AgentSessionEvent): void => {
    switch (e.type) {
      case 'agent_start':
        write('▶ agent 开始处理');
        break;
      case 'message_start':
        if ((e as { message?: { role?: string } }).message?.role === 'assistant') {
          write('→ 已向模型发起请求（等待流式响应）');
        }
        break;
      case 'message_end': {
        const m = (e as { message?: { role?: string; content?: Array<{ type: string; text?: string }>; stopReason?: string; errorMessage?: string } }).message;
        if (m?.role !== 'assistant') break;
        const text = (m.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
        if (text.length === 0) {
          write(`⚠ 模型返回空内容（stop=${m.stopReason ?? '未知'}${m.errorMessage ? `，错误：${m.errorMessage}` : ''}）`);
        } else {
          write(`← 模型返回 ${text.length} 字（stop=${m.stopReason ?? 'stop'}）`);
        }
        break;
      }
      case 'tool_execution_start':
        write(`🔧 工具 ${(e as { toolName?: string }).toolName} 开始`);
        break;
      case 'tool_execution_end': {
        const t = e as { toolName?: string; isError?: boolean };
        write(`${t.isError ? '✗' : '✓'} 工具 ${t.toolName} 结束`);
        break;
      }
      case 'auto_retry_start':
        write(`⚠ 模型调用失败，自动重试 ${(e as { attempt?: number }).attempt}/${(e as { maxAttempts?: number }).maxAttempts}：${(e as { errorMessage?: string }).errorMessage}`);
        break;
      case 'compaction_end':
        if ((e as { errorMessage?: string }).errorMessage) {
          write(`⚠ 上下文压缩失败：${(e as { errorMessage?: string }).errorMessage}`);
        }
        break;
      case 'agent_end':
        write((e as { willRetry?: boolean }).willRetry ? '■ 本轮结束（将重试）' : '■ 本轮结束');
        break;
    }
  };
}

function appNameOf(id: string): string {
  const name = id.replace(/[^A-Za-z0-9_]/g, '');
  return /^[A-Za-z]/.test(name) ? name : 'app' + name;
}

/** Prompt Pack 示例矩阵 → 沙箱 examples/ 目录（agent 按需读取；cheatsheet 已在系统提示词） */
function injectExamples(ws: Workspace): void {
  EXAMPLES.forEach((ex, i) => {
    const slug = (ex.keywords[0] ?? 'sample').replace(/[^a-zA-Z0-9_]/g, '') || 'sample';
    ws.writeExample(`示例${String(i + 1).padStart(2, '0')}_${slug}.tdsl`, ex.tdsl);
  });
}
