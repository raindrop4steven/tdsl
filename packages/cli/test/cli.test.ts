import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { run, HELP } from '../src/index';
import { sanitizeAppName } from '../src/input';

const MODEL = `@datasource('defaultDS')
entity Order { id: Integer @pk; total: Decimal; }
`;
const QUERY = `function listOrders(): List<Order> {
  return Order.all;
}
`;
const BAD = `function bad(): List<Order> {
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

  it('generate：写出孤儿文件不残留（重复生成先清 src 顶层子树）', () => {
    const dir = makeDir({ 'a.tdsl': MODEL, 'b.tdsl': QUERY });
    const out = join(dir, 'generated');
    run(['generate', dir, '-o', out, '--java']);
    // 造孤儿：旧 app 名/已删除实体的残留（mvn 双主类事故根源，src 与 target 双路径都要能消失）
    const orphan = join(out, 'java', 'src', 'main', 'java', 'com', 'old', 'Orphan.java');
    mkdirSync(join(orphan, '..'), { recursive: true });
    writeFileSync(orphan, 'class Orphan {}', 'utf8');
    const batchClass = join(out, 'java', 'target', 'classes', 'com', 'old', 'Orphan.class');
    mkdirSync(join(batchClass, '..'), { recursive: true });
    writeFileSync(batchClass, 'x', 'utf8');
    run(['generate', dir, '-o', out, '--java']);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(batchClass)).toBe(false);
    // 正常产物仍在
    expect(existsSync(join(out, 'java', 'pom.xml'))).toBe(true);
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

describe('cli dev/32 libs 装载与 bundle-jar 产物头', () => {
  it('check 装载 libs/ 产物：dependency 声明 + 产物类调用通过', () => {
    const lib = JSON.stringify({
      eco: 'java',
      coordinate: 'com.alibaba:fastjson2:2.0.58',
      classes: [{ class: 'com.alibaba.fastjson2.JSON', alias: 'JSON', members: [{ name: 'toJSONString', static: true, params: ['Object'], ret: 'String', java: 'com.alibaba.fastjson2.JSON.toJSONString({0})' }] }],
    });
    const dir = makeDir({
      'a.tdsl': `dependency java "com.alibaba:fastjson2:2.0.58";\n@export\nfunction f(o: Object): String { return JSON.toJSONString(o); }\n`,
      'libs/fastjson2.json': lib,
    });
    const r = run(['check', dir]);
    expect(r.code).toBe(0);
  });

  it('D-dep-1 人话化：用了未声明依赖 → check 退出码 1', () => {
    const lib = JSON.stringify({
      eco: 'java',
      coordinate: 'com.alibaba:fastjson2:2.0.58',
      classes: [{ class: 'com.alibaba.fastjson2.JSON', alias: 'JSON', members: [{ name: 'toJSONString', static: true, params: ['Object'], ret: 'String', java: 'com.alibaba.fastjson2.JSON.toJSONString({0})' }] }],
    });
    const dir = makeDir({
      'a.tdsl': `@export\nfunction f(o: Object): String { return JSON.toJSONString(o); }\n`,
      'libs/fastjson2.json': lib,
    });
    const r = run(['check', dir]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('未声明依赖');
  });

  it('libs 产物格式非法 → CliError 人话提示', () => {
    const dir = makeDir({
      'a.tdsl': MODEL,
      'libs/bad.json': '[]',
    });
    const r = run(['check', dir]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('libs 产物格式非法');
  });

  it('bundle-jar 产物带头对象（eco/coordinate/classes）；--coord 覆盖', () => {
    // 用本仓一个已知类编译产物 jar 不可行——退而求其次：验证 deriveCoordinate 兜底与输出格式
    // 真实 jar 路径存在时才跑（CI/他机无 D:/fastjson2 时跳过）
    const jar = 'D:/fastjson2-2.0.58.jar';
    if (!existsSync(jar)) return;
    const dir = makeDir({ 'x.txt': '' });
    const out = join(dir, 'out.json');
    const r = run(['bundle-jar', jar, '-o', out, '--classes', 'com.alibaba.fastjson2.JSON', '--coord', 'com.alibaba:fastjson2:2.0.58']);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(readFileSync(out, 'utf8'));
    expect(parsed.eco).toBe('java');
    expect(parsed.coordinate).toBe('com.alibaba:fastjson2:2.0.58');
    expect(Array.isArray(parsed.classes)).toBe(true);
    expect(parsed.classes[0].class).toBe('com.alibaba.fastjson2.JSON');
  });
});
