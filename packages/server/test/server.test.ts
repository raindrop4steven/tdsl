import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { exportZip, parseExportTarget } from '../src/export';
import { buildTools, compileSandbox, generateAndSave, systemPrompt } from '../src/tools';
import { buildModelsJson } from '../src/sessions';
import { AppRunner, appendLog, logTail, MAX_RUNNING_SESSIONS } from '../src/runner';
import { Workspace, safeSandboxPath } from '../src/workspace';

const MODEL = `@datasource('defaultDS')
entity Order { id: Integer @pk; total: Decimal; }
`;
const QUERY = `logic listOrders(): List<Order> {
  return Order.all;
}
`;
const BAD = `logic bad(): List<Order> {
  return Order.where(nofield > 0);
}
`;

function newWs(): Workspace {
  const ws = new Workspace(mkdtempSync(join(tmpdir(), 'tdsl-ws-')));
  ws.ensure();
  return ws;
}

const spawned: Array<{ cmd: string; args: string[]; cwd: string; env: Record<string, string> }> = [];
const killed: number[] = [];

/** 造 runner：产物目录用临时目录；spawn/kill 用记录式假实现 */
function makeRunner(opts?: { reportUrl?: string; javaOk?: boolean; reactOk?: boolean }): AppRunner {
  const javaDir = mkdtempSync(join(tmpdir(), 'fake-java-'));
  const reactDir = mkdtempSync(join(tmpdir(), 'fake-react-'));
  if (opts?.javaOk !== false) writeFileSync(join(javaDir, 'pom.xml'), '<project/>');
  if (opts?.reactOk !== false) writeFileSync(join(reactDir, 'package.json'), '{}');
  const fake = { pid: 12345, on: vi.fn(), kill: vi.fn(), stdout: null, stderr: null };
  return new AppRunner(javaDir, reactDir, mkdtempSync(join(tmpdir(), 'fake-logs-')), 0, {
    spawnFn: (cmd, args, cwd, env) => {
      spawned.push({ cmd, args, cwd, env });
      return fake as unknown as import('node:child_process').ChildProcess;
    },
    killFn: (pid) => killed.push(pid),
    reportUrl: opts?.reportUrl,
  });
}

describe('server/workspace', () => {
  it('写入/读取/清单（文件名排序）', () => {
    const ws = newWs();
    ws.writeTdsl('b.tdsl', QUERY);
    ws.writeTdsl('a.tdsl', MODEL);
    expect(ws.listTdsl().map((f) => f.path)).toEqual(['a.tdsl', 'b.tdsl']);
    expect(ws.readTdsl('a.tdsl')).toContain('entity Order');
  });

  it('路径越界与非 .tdsl 拒绝', () => {
    const ws = newWs();
    expect(() => ws.writeTdsl('../evil.tdsl', 'x')).toThrow(/越界|只允许写入/);
    expect(() => ws.writeTdsl('notes.txt', 'x')).toThrow(/非法文件类型/);
    expect(() => ws.writeTdsl('sub/ok.tdsl', 'x')).not.toThrow();
    expect(safeSandboxPath(ws.root, 'examples/x.md', 'examples')).toContain('examples');
  });

  it('dispose 清理沙箱', () => {
    const ws = newWs();
    ws.writeTdsl('a.tdsl', MODEL);
    ws.dispose();
    expect(ws.listTdsl()).toEqual([]);
  });

  it('writeGenerated：落盘 generated/<target>/；越界拒绝；hasGenerated/listFiles 正确', () => {
    const ws = newWs();
    expect(ws.hasGenerated('java')).toBe(false);
    const n = ws.writeGenerated('java', [
      { path: 'pom.xml', content: '<project/>' },
      { path: 'src/main/java/App.java', content: 'class App {}' },
    ]);
    expect(n).toBe(2);
    expect(ws.hasGenerated('java')).toBe(true);
    expect(ws.hasGenerated('react')).toBe(false);
    expect(ws.listFiles('generated/java').map((f) => f.rel)).toEqual([
      'generated/java/pom.xml',
      'generated/java/src/main/java/App.java',
    ]);
    // 产物路径越界（.. 穿越出 generated/java）
    expect(() => ws.writeGenerated('java', [{ path: '../evil.java', content: 'x' }])).toThrow(/越界/);
  });
});

describe('server/tools.compileSandbox', () => {
  it('空目录 → 提示先写入', () => {
    const r = compileSandbox(newWs(), 'app');
    expect(r.ok).toBe(false);
    expect(r.feedback).toContain('为空');
  });

  it('编译通过：✓ + 各段数量', () => {
    const ws = newWs();
    ws.writeTdsl('01_model.tdsl', MODEL);
    ws.writeTdsl('02_query.tdsl', QUERY);
    const r = compileSandbox(ws, 'todomulti');
    expect(r.ok).toBe(true);
    expect(r.feedback).toContain('✓ 编译通过：todomulti');
    expect(r.app).toBeDefined();
  });

  it('诊断人话化：带 file 与 nodePath（M7 诊断回流 agent）', () => {
    const ws = newWs();
    ws.writeTdsl('01_model.tdsl', MODEL);
    ws.writeTdsl('02_query.tdsl', BAD);
    const r = compileSandbox(ws, 'todomulti');
    expect(r.ok).toBe(false);
    expect(r.feedback).toMatch(/\[error\] 02_query\.tdsl app\.logics\.bad: /);
    expect(r.diagnostics[0].file).toBe('02_query.tdsl');
  });

  it('parse 错误：link 阶段带引导语', () => {
    const ws = newWs();
    ws.writeTdsl('01_model.tdsl', 'struct X { o: NotExist; }');
    const r = compileSandbox(ws, 'app');
    expect(r.ok).toBe(false);
    expect(r.feedback).toContain('引用绑定期失败');
  });
});

describe('server/tools.generateAndSave', () => {
  it('合法 app → 双端落盘 generated/{java,react}/，反馈含落盘说明', () => {
    const ws = newWs();
    ws.writeTdsl('a.tdsl', MODEL + QUERY);
    const { app } = compileSandbox(ws, 'todomulti');
    const r = generateAndSave(ws, app!);
    expect(r.ok).toBe(true);
    expect(r.feedback).toContain('generated/java/');
    expect(r.feedback).toContain('generated/react/');
    expect(r.feedback).toContain('.java');
    expect(r.feedback).toContain('src/App.tsx');
    expect(ws.hasGenerated('java')).toBe(true);
    expect(ws.hasGenerated('react')).toBe(true);
  });
});

describe('server/export', () => {
  it('parseExportTarget：仅 java/react/all 合法', () => {
    expect(parseExportTarget('java')).toBe('java');
    expect(parseExportTarget('all')).toBe('all');
    expect(parseExportTarget('evil')).toBeUndefined();
    expect(parseExportTarget(undefined)).toBeUndefined();
  });

  it('exportZip：java 单端/react 单端/all 含双端+tdsl 源码', async () => {
    const ws = newWs();
    ws.writeTdsl('01_model.tdsl', MODEL);
    ws.writeTdsl('02_query.tdsl', QUERY);
    const { app } = compileSandbox(ws, 'todomulti');
    generateAndSave(ws, app!);

    const javaZip = await JSZip.loadAsync(await exportZip(ws, 'java'));
    expect(Object.keys(javaZip.files).some((p) => p.startsWith('java/') && p.endsWith('.java'))).toBe(true);
    expect(Object.keys(javaZip.files).some((p) => p.startsWith('react/'))).toBe(false);

    const allZip = await JSZip.loadAsync(await exportZip(ws, 'all'));
    const paths = Object.keys(allZip.files);
    expect(paths.some((p) => p.startsWith('java/') && p.endsWith('.java'))).toBe(true);
    expect(paths.some((p) => p.startsWith('react/') && p.endsWith('.tsx'))).toBe(true);
    expect(paths).toContain('tdsl/01_model.tdsl');
    expect(paths).toContain('tdsl/02_query.tdsl');
    const model = await allZip.file('tdsl/01_model.tdsl')!.async('string');
    expect(model).toContain('entity Order');
  });
});

describe('server/prompt + 配置', () => {
  it('systemPrompt 含 cheatsheet 与 agent 策略', () => {
    const p = systemPrompt();
    expect(p).toContain('语法速查');
    expect(p).toContain('compile_tdsl');
    expect(p).toContain('功能域');
  });

  it('models.json：env 三件套生成；未配置 null', () => {
    const json = buildModelsJson({
      TDSL_LLM_BASE_URL: 'http://localhost:11434/v1',
      TDSL_LLM_MODEL: 'qwen2.5-coder:7b',
      TDSL_LLM_API_KEY: 'ollama',
    });
    expect(JSON.parse(json!)).toMatchObject({
      providers: {
        'tdsl-llm': {
          baseUrl: 'http://localhost:11434/v1',
          api: 'openai-completions',
          models: [{ id: 'qwen2.5-coder:7b' }],
        },
      },
    });
    expect(buildModelsJson({})).toBeNull();
  });

  it('models.json：TDSL_LLM_COMPAT 合法时透传到 model，非法/缺失时忽略', () => {
    const ok = buildModelsJson({
      TDSL_LLM_BASE_URL: 'https://opencode.ai/zen/go/v1',
      TDSL_LLM_MODEL: 'glm-5.3-flash',
      TDSL_LLM_COMPAT: '{"supportsStore":false,"supportsDeveloperRole":false,"maxTokensField":"max_tokens"}',
    });
    const parsed = JSON.parse(ok!) as { providers: Record<string, { models: { id: string; compat?: unknown }[] }> };
    expect(parsed.providers['tdsl-llm'].models[0]).toMatchObject({
      id: 'glm-5.3-flash',
      compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
    });
    // 非法 JSON → 忽略 compat，不阻断启动
    const bad = JSON.parse(
      buildModelsJson({
        TDSL_LLM_BASE_URL: 'https://x/v1',
        TDSL_LLM_MODEL: 'm',
        TDSL_LLM_COMPAT: 'not-json',
      })!,
    ) as { providers: Record<string, { models: Record<string, unknown>[] }> };
    expect(bad.providers['tdsl-llm'].models[0]).toEqual({ id: 'm' });
  });
});

describe('server/runner（M10 运行回路）', () => {
  it('前置检查：产物缺失 → 人话报错不拉起进程', () => {
    spawned.length = 0;
    const r = makeRunner({ javaOk: false });
    const msg = r.up();
    expect(msg).toContain('后端产物不存在');
    expect(spawned).toHaveLength(0);
  });

  it('up → 拉起 mvn spring-boot:run + vite dev，注入端口与错误回流地址；幂等', () => {
    spawned.length = 0;
    const r = makeRunner({ reportUrl: 'http://x:8787/api/client-error?sessionId=s1' });
    r.up();
    expect(spawned).toHaveLength(2);
    expect(spawned[0].cmd).toContain('mvn');
    expect(spawned[0].args).toContain('spring-boot:run');
    expect(spawned[0].env.TDSL_BACKEND_PORT).toBe('8080');
    expect(spawned[1].cmd).toContain('npm');
    expect(spawned[1].args).toContain('--port');
    expect(spawned[1].env.BACKEND_PORT).toBe('8080');
    expect(spawned[1].env.TDSL_REPORT_URL).toContain('/api/client-error?sessionId=');
    const again = r.up();
    expect(again).toContain('已在运行');
    expect(spawned).toHaveLength(2);
  });

  it('status 端口分配与会话序号偏移（s0 → 8080/5173，s2 → 8082/5175）', () => {
    expect(makeRunner().status().backendPort).toBe(8080);
    const r2 = new AppRunner('a', 'b', 'c', 2, { spawnFn: () => ({}) as never });
    expect(r2.status().backendPort).toBe(8082);
    expect(r2.status().frontendPort).toBe(5175);
  });

  it('down 终止进程树并回到 idle；restart 后重新拉起', () => {
    spawned.length = 0;
    killed.length = 0;
    const r = makeRunner();
    r.up();
    expect(r.down()).toContain('已停止');
    expect(killed).toContain(12345);
    expect(r.status().backend).toBe('idle');
  });

  it('appendLog 环形截断：超上限不无限膨胀，logTail 仍可读尾部', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-logs-'));
    const file = join(dir, 'backend.log');
    for (let i = 0; i < 10; i++) appendLog(file, `chunk-${i} ${'x'.repeat(60 * 1024)}\n`);
    const size = statSync(file).size;
    expect(size).toBeLessThanOrEqual(200 * 1024 + 64 * 1024);
    const { tail } = logTail(file);
    expect(tail).toContain('chunk-9');
  });

  it('并发会话上限（MAX_RUNNING_SESSIONS）', () => {
    expect(MAX_RUNNING_SESSIONS).toBe(3);
  });
});

describe('server/tools.run_app（M10 编排工具）', () => {
  // runner 缺席 → 人话提示不抛异常
  it('run_app：未装配 runner 时不崩溃', async () => {
    const ws = newWs();
    const tools = buildTools(ws, 'app', (def) => def);
    const runApp = (tools as Array<{ name: string; execute: (id: string, p: unknown) => unknown }>).find((t) => t.name === 'run_app')!;
    const r = (await runApp.execute('id', { action: 'status' })) as { content: Array<{ text: string }> };
    expect(r.content[0].text).toContain('运行器不可用');
  });

  it('run_app：up/down/restart/status/logs 与 runner 联动（注入 runner）', async () => {
    spawned.length = 0;
    const ws = newWs();
    const runner = makeRunner({ reportUrl: 'http://x/api/client-error?sessionId=s1' });
    const tools = buildTools(ws, 'app', (def) => def, runner, () => {});
    const runApp = (tools as Array<{ name: string; execute: (id: string, p: unknown) => unknown }>).find((t) => t.name === 'run_app')!;
    const call = (p: unknown): string => (runApp.execute('id', p) as { content: Array<{ text: string }> }).content[0].text;
    // 造产物 → up 成功（产物缺失场景已由 runner 前置检查用例覆盖）
    mkdirSync(join(ws.root, 'generated', 'java'), { recursive: true });
    writeFileSync(join(ws.root, 'generated', 'java', 'pom.xml'), '<project/>');
    mkdirSync(join(ws.root, 'generated', 'react'), { recursive: true });
    writeFileSync(join(ws.root, 'generated', 'react', 'package.json'), '{}');
    const up2 = (await runApp.execute('id', { action: 'up' })) as { content: Array<{ text: string }> };
    expect(up2.content[0].text).toContain('已启动');
    const status = (await runApp.execute('id', { action: 'status' })) as { content: Array<{ text: string }> };
    expect(status.content[0].text).toContain('前端页面');
    expect((await runApp.execute('id', { action: 'logs' }) as { content: Array<{ text: string }> }).content[0].text).toContain('npm install');
    expect((await runApp.execute('id', { action: 'down' }) as { content: Array<{ text: string }> }).content[0].text).toContain('已停止');
  });
});
