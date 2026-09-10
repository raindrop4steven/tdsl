import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { exportZip, parseExportTarget } from '../src/export';
import { compileSandbox, generateAndSave, systemPrompt } from '../src/tools';
import { buildModelsJson } from '../src/sessions';
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
