/**
 * M10 运行回路：会话内前后端进程编排（纯逻辑层可测；spawn/kill 可注入）。
 * 状态机 idle → starting → up/failed → down；端口 = 基数 + 会话序号；日志环形写入沙箱 logs/。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, truncateSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';

export type ProcState = 'idle' | 'starting' | 'up' | 'down' | 'failed';

/** 全局并发会话上限（dev/24 Gate：每会话一组前后端进程，全局 ≤3） */
export const MAX_RUNNING_SESSIONS = 3;

export type SpawnFn = (
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
) => ChildProcess;

export interface RunnerStatus {
  backend: ProcState;
  frontend: ProcState;
  backendPort: number;
  frontendPort: number;
  urls: { backendHealth: string; frontend: string };
}

/** 日志环形上限（字节）：超出截头保留尾部 */
const LOG_MAX_BYTES = 200 * 1024;
/** 后端就绪探针超时/间隔（ms） */
const BACKEND_READY_TIMEOUT_MS = 90_000;
const BACKEND_PROBE_INTERVAL_MS = 1500;

/** 追加日志（环形：超出上限截头保留尾部），供 runner 与 client-error 回流共用 */
export function appendLog(file: string, text: string): void {
  mkdirSync(join(file, '..'), { recursive: true });
  appendFileSync(file, text, 'utf8');
  let size = 0;
  try {
    size = statSync(file).size;
  } catch {
    return;
  }
  if (size > LOG_MAX_BYTES) {
    const buf = readFileSync(file, 'utf8');
    truncateSync(file, 0);
    appendFileSync(file, buf.slice(buf.length - LOG_MAX_BYTES / 2), 'utf8');
  }
}

/** 日志尾部 + ERROR 摘要（给 agent/前端展示） */
export function logTail(file: string, lines = 30): { tail: string; errors: string[] } {
  if (!existsSync(file)) return { tail: '', errors: [] };
  const all = readFileSync(file, 'utf8').split('\n');
  const tail = all.slice(-lines).join('\n');
  const errors = all.filter((l) => /ERROR|Exception|FATAL|error TS/i.test(l)).slice(-10);
  return { tail, errors };
}

export class AppRunner {
  private backend?: ChildProcess;
  private frontend?: ChildProcess;
  private backendState: ProcState = 'idle';
  private frontendState: ProcState = 'idle';
  private readyProbe?: ReturnType<typeof setInterval>;
  private readonly backendPort: number;
  private readonly frontendPort: number;
  private readonly spawnFn: SpawnFn;
  private readonly killFn: (pid: number) => void;
  private readonly reportUrl?: string;

  constructor(
    private readonly javaDir: string,
    private readonly reactDir: string,
    private readonly logsDir: string,
    sessionSeq: number,
    opts?: { spawnFn?: SpawnFn; killFn?: (pid: number) => void; reportUrl?: string },
  ) {
    this.backendPort = 8080 + sessionSeq;
    this.frontendPort = 5173 + sessionSeq;
    this.spawnFn =
      opts?.spawnFn ??
      ((_cmd, args, cwd, env) => {
        throw new Error(`spawn 未注入: ${args.join(' ')} @ ${cwd} ${JSON.stringify(env)}`);
      });
    this.killFn = opts?.killFn ?? (() => {});
    this.reportUrl = opts?.reportUrl;
  }

  status(): RunnerStatus {
    return {
      backend: this.backendState,
      frontend: this.frontendState,
      backendPort: this.backendPort,
      frontendPort: this.frontendPort,
      urls: {
        backendHealth: `http://localhost:${this.backendPort}/healthz`,
        frontend: `http://localhost:${this.frontendPort}`,
      },
    };
  }

  /** 产物前置检查（未 generate 就 up → 人话报错） */
  private precheck(): string | null {
    if (!existsSync(join(this.javaDir, 'pom.xml'))) {
      return '后端产物不存在：请先让 agent 调用 generate_code 生成代码。';
    }
    if (!existsSync(join(this.reactDir, 'package.json'))) {
      return '前端产物不存在：请先让 agent 调用 generate_code 生成代码。';
    }
    return null;
  }

  /** 启动前后端；幂等（已 starting/up 直接返回当前状态） */
  up(onState?: () => void): string {
    const pre = this.precheck();
    if (pre) return `✗ ${pre}`;
    if (this.backendState === 'starting' || this.backendState === 'up') {
      return `已在运行：后端 ${this.backendState}，前端 http://localhost:${this.frontendPort}`;
    }
    this.backendState = 'starting';
    this.frontendState = 'starting';

    // 前端依赖安装（首次 up / node_modules 缺失时；阻塞完成后才拉 vite）
    this.ensureDeps();

    // 后端：mvn spring-boot:run（H2 内存库，端口由 env 注入）
    this.backend = this.spawnFn('mvn.cmd', ['-q', 'spring-boot:run'], this.javaDir, {
      TDSL_BACKEND_PORT: String(this.backendPort),
    });
    this.backend.stdout?.on('data', (d) => appendLog(join(this.logsDir, 'backend.log'), String(d)));
    this.backend.stderr?.on('data', (d) => appendLog(join(this.logsDir, 'backend.log'), String(d)));
    this.backend.on('exit', (code) => {
      this.backendState = code === 0 || this.backendState === 'down' ? 'down' : 'failed';
      onState?.();
    });

    // 前端：vite dev（BACKEND_PORT → /api 代理；TDSL_REPORT_URL → 错误回流 agent 服务）
    this.frontend = this.spawnFn('npm.cmd', ['run', 'dev', '--', '--port', String(this.frontendPort), '--strictPort'], this.reactDir, {
      BACKEND_PORT: String(this.backendPort),
      TDSL_REPORT_URL: this.reportUrl ?? '',
    });
    this.frontend.stdout?.on('data', (d) => appendLog(join(this.logsDir, 'frontend.log'), String(d)));
    this.frontend.stderr?.on('data', (d) => appendLog(join(this.logsDir, 'frontend.log'), String(d)));
    this.frontend.on('exit', (code) => {
      this.frontendState = code === 0 || this.frontendState === 'down' ? 'down' : 'failed';
      onState?.();
    });

    this.probeBackend(onState);
    onState?.();
    return `已启动：后端启动中（探针 http://localhost:${this.backendPort}/healthz），前端 http://localhost:${this.frontendPort}`;
  }

  /** react 依赖安装（node_modules 缺失时执行一次；日志入 frontend.log） */
  private ensureDeps(): void {
    if (existsSync(join(this.reactDir, 'node_modules'))) return;
    appendLog(join(this.logsDir, 'frontend.log'), '[runner] npm install 中（首次启动）…\n');
    const r = spawnSync('npm.cmd', ['install', '--no-audit', '--no-fund'], {
      cwd: this.reactDir,
      env: { ...process.env },
      shell: true,
      timeout: 300_000,
      encoding: 'utf8',
    });
    appendLog(join(this.logsDir, 'frontend.log'), `[runner] npm install ${r.status === 0 ? '完成' : `失败(${r.status})`}\n${r.stdout ?? ''}${r.stderr ?? ''}\n`);
  }

  down(onState?: () => void): string {
    if (this.backend) {
      this.killFn(this.backend.pid ?? 0);
      this.backend = undefined;
    }
    if (this.frontend) {
      this.killFn(this.frontend.pid ?? 0);
      this.frontend = undefined;
    }
    if (this.readyProbe) clearInterval(this.readyProbe);
    this.backendState = 'idle';
    this.frontendState = 'idle';
    onState?.();
    return '已停止（前后端进程已终止，端口释放）';
  }

  async restart(onState?: () => void): Promise<string> {
    this.down();
    await new Promise((r) => setTimeout(r, 1500));
    return this.up(onState);
  }

  /** 面板/agent 的日志视图：backend/frontend/client 三源尾部 + ERROR 摘要 */
  logs(which?: 'backend' | 'frontend' | 'client'): string {
    const pick = (file: string, label: string): string => {
      const { tail, errors } = logTail(join(this.logsDir, file));
      if (!tail) return '';
      const errPart = errors.length > 0 ? `\n[ERROR 摘要]\n${errors.join('\n')}` : '';
      return `[${label}]\n${tail}${errPart}`;
    };
    if (which) return pick(`${which}.log`, which) || `[${which}] 暂无日志`;
    return (
      ['backend', 'frontend', 'client']
        .map((w) => pick(`${w}.log`, w))
        .filter(Boolean)
        .join('\n\n') || '暂无日志'
    );
  }

  private probeBackend(onState?: () => void): void {
    const started = Date.now();
    if (this.readyProbe) clearInterval(this.readyProbe);
    this.readyProbe = setInterval(() => {
      void (async () => {
        if (Date.now() - started > BACKEND_READY_TIMEOUT_MS) {
          if (this.readyProbe) clearInterval(this.readyProbe);
          this.backendState = 'failed';
          onState?.();
          return;
        }
        try {
          const res = await fetch(`http://localhost:${this.backendPort}/healthz`, { signal: AbortSignal.timeout(1000) });
          if (res.ok) {
            if (this.readyProbe) clearInterval(this.readyProbe);
            this.backendState = 'up';
            onState?.();
          }
        } catch {
          /* 未就绪，继续探测 */
        }
      })();
    }, BACKEND_PROBE_INTERVAL_MS);
  }
}
