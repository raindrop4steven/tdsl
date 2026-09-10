import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { run, HELP } from '../src/index';
import { sanitizeAppName } from '../src/input';

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

let tmp: string | null = null;
function makeDir(files: Record<string, string>): string {
  tmp = mkdtempSync(join(tmpdir(), 'tdsl-cli-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(tmp, name, '..'), { recursive: true });
    writeFileSync(join(tmp, name), content, 'utf8');
  }
  return tmp;
}
afterEach(() => {
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  }
});

describe('cli/input', () => {
  it('目录扫描：*.tdsl 按文件名排序，忽略其他扩展', () => {
    const dir = makeDir({
      'b.tdsl': QUERY,
      'a.tdsl': MODEL,
      'ignore.txt': 'not tdsl',
    });
    const r = run(['check', dir]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('0 问题');
  });

  it('目录无 .tdsl 文件 → 报错', () => {
    const dir = makeDir({ 'x.txt': 'nothing' });
    const r = run(['check', dir]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('.tdsl');
  });

  it('路径不存在 → 报错', () => {
    const r = run(['check', join(tmpdir(), 'no-such-dir-xyz')]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('路径不存在');
  });

  it('app 名清洗：todo-multi → todomulti', () => {
    expect(sanitizeAppName('todo-multi')).toBe('todomulti');
  });

  it('app 名清洗：数字开头补 app 前缀；空 → app', () => {
    expect(sanitizeAppName('2024app')).toBe('app2024app');
    expect(sanitizeAppName('===')).toBe('app');
    expect(sanitizeAppName('my_app')).toBe('my_app');
  });
});

describe('cli/commands', () => {
  it('parse 摘要：各段数量', () => {
    const dir = makeDir({ 'a.tdsl': MODEL, 'b.tdsl': QUERY });
    const r = run(['parse', dir]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('entities 1');
    expect(r.stdout).toContain('logics 1');
  });

  it('parse --json：输出完整 AST JSON', () => {
    const dir = makeDir({ 'a.tdsl': MODEL });
    const r = run(['parse', dir, '--json']);
    expect(r.code).toBe(0);
    const app = JSON.parse(r.stdout);
    expect(app.kind).toBe('App');
    expect(app.datasources[0].entities[0].name).toBe('Order');
  });

  it('check：诊断人话格式（file + path + message），退出码 1', () => {
    const dir = makeDir({ 'a.tdsl': MODEL, 'bad.tdsl': BAD });
    const r = run(['check', dir]);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/\[error\] bad\.tdsl app\.logics\.bad: /);
  });

  it('check：parse 错误带文件名（目录输入时 path=文件名）', () => {
    const dir = makeDir({ 'bad.tdsl': 'entity {{{' });
    const r = run(['check', dir]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('bad.tdsl');
  });

  it('generate：写盘到 -o 目录（默认双端）', () => {
    const dir = makeDir({ 'a.tdsl': MODEL, 'b.tdsl': QUERY });
    const out = join(dir, 'generated');
    const r = run(['generate', dir, '-o', out]);
    expect(r.code).toBe(0);
    const app = r.app!;
    expect(app.name).toBe(sanitizeAppName(dir.split(/[\\/]/).pop()!));
    // 双端各写各的子目录（runBuild 依赖 outDir/{java,react}）
    expect(existsSync(join(out, 'java', 'pom.xml'))).toBe(true);
    expect(existsSync(join(out, 'react', 'index.html'))).toBe(true);
    expect(existsSync(join(out, 'react', '.npmrc'))).toBe(true);
  });

  it('generate --java：只生成 Java 端', () => {
    const dir = makeDir({ 'a.tdsl': MODEL, 'b.tdsl': QUERY });
    const out = join(dir, 'out-java');
    const r = run(['generate', dir, '-o', out, '--java']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('java:');
    expect(r.stdout).not.toContain('react');
  });

  it('app 名非法清洗后合法（codegen 防线不触发）', () => {
    const parent = makeDir({});
    const dir = join(parent, '01_x');
    mkdirSync(dir);
    writeFileSync(join(dir, 'a.tdsl'), MODEL, 'utf8');
    // 目录名 01_x → app01_x，合法 Java 标识符
    const r = run(['parse', dir]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('app01_x');
  });
});

describe('cli/bin 交互', () => {
  it('help / 无参 → 帮助文本，退出码 0', () => {
    expect(run([]).code).toBe(0);
    expect(run(['help']).stdout).toContain('dsl — TDSL 命令行工具');
  });

  it('未知命令 / 未知选项 / 缺少输入 → 退出码 1', () => {
    expect(run(['frobnicate', 'x']).code).toBe(1);
    expect(run(['check']).code).toBe(1);
    const dir = makeDir({ 'a.tdsl': MODEL });
    expect(run(['parse', dir, '--name']).code).toBe(1);
  });
});
