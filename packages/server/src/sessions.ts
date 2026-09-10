/**
 * 会话装配（M9）：id → { AgentSession, Workspace }。
 * pi 承担 turn loop / 上下文压缩 / 会话持久化；本层只做沙箱 + 工具 + 提示词装配与事件转发。
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  defineTool as piDefineTool,
  type AgentSession,
  type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';
import { EXAMPLES } from '@tdsl/llm';
import { AppRunner, MAX_RUNNING_SESSIONS } from './runner';
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

  /** baseDir 缺省 = 系统临时目录（测试/演示免清理；生产部署配 TDSL_SESSION_DIR） */
  constructor(baseDir?: string, spawnOpts?: SpawnOptions) {
    this.baseDir = baseDir ?? mkdtempSync(join(tmpdir(), 'tdsl-agent-'));
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
  // 兼容性开关透传（pi 省略时按“标准 OpenAI”探测，GLM 等端点需要显式覆盖，如 maxTokensField）
  const compat = parseCompat(env.TDSL_LLM_COMPAT);
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
    tools: ['write_tdsl_files', 'read_tdsl_files', 'compile_tdsl', 'generate_code'],
    customTools: tools as never,
  });

  const entry: SessionEntry = { id, session, ws, runner };
  if (onEvent) session.subscribe(onEvent);
  return entry;
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
