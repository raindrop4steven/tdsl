import { describe, expect, it } from 'vitest';
import { parse, parseProject } from '../src/index';

describe('M11 @app 应用显示名（parser）', () => {
  it('@app 解析 → AppNode.title（生成器搬运，缺省回落）', () => {
    const app = parse("@app('芋道 ERP 管理系统')\n@datasource('defaultDS')\nentity A { id: Integer @pk; }");
    expect(app.title).toBe('芋道 ERP 管理系统');
  });

  it('多文件合并保留唯一 @app（后写覆盖）', () => {
    const app = parseProject([
      { path: 'a.tdsl', content: "@app('A 系统')\n@datasource('d')\nentity E { id: Integer @pk; }" },
      { path: 'b.tdsl', content: "@app('B 系统')\npage X { <text field='x' /> }" },
    ]);
    expect(app.title).toBe('B 系统');
  });

  it('无 @app → title undefined（缺省回落 cap(app.name)）', () => {
    const app = parse("@datasource('defaultDS')\nentity A { id: Integer @pk; }");
    expect(app.title).toBeUndefined();
  });

  it('@app 缺括号/字符串 → 语法报错', () => {
    expect(() => parse('@app 芋道')).toThrow();
    expect(() => parse("@app('芋道'")).toThrow();
  });
});
