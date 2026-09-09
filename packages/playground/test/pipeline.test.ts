import React from 'react';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/pipeline';
import { SAMPLES } from '../src/samples';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// dev/20 验收：6 示例全绿 + 双端产物与 slice 同路径
describe('playground/pipeline', () => {
  it('示例库包含 todo.tdsl + llm 矩阵 5 域，全部编译通过', () => {
    expect(SAMPLES).toHaveLength(6);
    for (const s of SAMPLES) {
      const r = compile(s.tdsl);
      expect(r.ok, `${s.name} 编译失败: ${JSON.stringify(r.parseError ?? r.diagnostics)}`).toBe(true);
      expect(r.java.length).toBeGreaterThan(0);
      expect(r.react.length).toBeGreaterThan(0);
    }
  });

  it('todo.tdsl 产物与 slice 硬编码场景一致（抽查实体/接口文件存在）', () => {
    const r = compile(SAMPLES[0].tdsl);
    expect(r.ok).toBe(true);
    const javaPaths = r.java.map((f) => f.path);
    expect(javaPaths).toContain('src/main/java/com/todo/entity/Order.java');
    expect(javaPaths).toContain('src/main/java/com/todo/controller/OrderApiController.java');
    const reactPaths = r.react.map((f) => f.path);
    expect(reactPaths).toContain('src/App.tsx');
    expect(reactPaths.some((p) => p.startsWith('src/pages/'))).toBe(true);
  });

  it('语法错误：返回行列 + 不产生产物', () => {
    const r = compile('entity Todo { id: Integer }');
    expect(r.ok).toBe(false);
    expect(r.parseError).toBeDefined();
    expect(r.parseError?.line).toBe(1);
    expect(r.java).toHaveLength(0);
    expect(r.react).toHaveLength(0);
  });

  it('link 阶段错误：标记 linkStage（编辑器不标红线，诊断面板给引导语）', () => {
    const r = compile(
      "entity Todo { id: Integer @pk; }\npage A { <button text=\"去\" action={navigate('Nope')} /> }",
    );
    expect(r.ok).toBe(false);
    expect(r.parseError?.linkStage).toBe(true);
    expect(r.parseError?.message).toContain('引用绑定期失败');
  });

  it('typecheck 错误：诊断带 nodePath，产物为空', () => {
    const src = `
entity Order { id: Integer @pk; total: Decimal; }
@export
logic bad(): List<Order> {
  return Order.batchDelete();
}
`;
    const r = compile(src);
    expect(r.ok).toBe(false);
    expect(r.parseError).toBeUndefined();
    expect(r.diagnostics.length).toBeGreaterThan(0);
    expect(r.diagnostics.some((d) => d.path?.includes('bad'))).toBe(true);
    expect(r.java).toHaveLength(0);
  });

  it('示例源与 slice 用同一份 todo.tdsl（防漂移）', () => {
    const todoPath = fileURLToPath(new URL('../../../examples/todo-app/todo.tdsl', import.meta.url));
    expect(SAMPLES[0].tdsl).toBe(readFileSync(todoPath, 'utf8'));
  });
});
