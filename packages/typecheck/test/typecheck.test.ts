import { describe, expect, it } from 'vitest';
import { createNode, type AppNode, type DataSourceNode, type EntityNode } from '@tdsl/core';
import { parse } from '@tdsl/parser';
import { check } from '../src/index';

const GOOD = `
@datasource('defaultDS')
entity Todo {
  id: Integer @pk;
  title: String;
  done: Boolean;
}

@export
logic findTodos(): List<Todo> {
  result := new List<Todo>();
  for (todo in Todo.all) {
    if (todo.done === false) {
      result.add(todo);
    }
  }
  return result;
}
`;

describe('typecheck', () => {
  it('passes on valid app', () => {
    const app = parse(GOOD);
    const r = check(app);
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toHaveLength(0);
  });

  it('reports dangling reference for programmatically-built AST', () => {
    const entity: EntityNode = {
      ...createNode('Entity'),
      name: 'Todo',
      properties: [
        {
          ...createNode('EntityProperty'),
          name: 'owner',
          type: { kind: 'reference', path: 'app.datasources.defaultDS.entities.Nope' },
        },
      ],
    };
    const ds: DataSourceNode = { ...createNode('DataSource'), name: 'defaultDS', entities: [entity] };
    const app: AppNode = {
      ...createNode('App'),
      name: 'todo',
      datasources: [ds],
      structures: [],
      enums: [],
      logics: [],
    };
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].message).toContain('悬空引用');
    expect(r.diagnostics[0].severity).toBe('error');
  });

  it('reports invalid ForEach container', () => {
    const app = parse(`
entity Todo { id: Integer @pk; }
@export
logic bad(): List<Todo> {
  result := new List<Todo>();
  for (todo in something.else) { result.add(todo); }
  return result;
}
`);
    // 上面 something.else 引用不存在——parser link 不解析成员，typecheck 应报 ForEach 容器错
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('ForEach 容器'))).toBe(true);
  });
});