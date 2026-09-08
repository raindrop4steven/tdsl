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
      interfaces: [],
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

  it('reports dangling interface logicRef', () => {
    const app = parse(`
entity Todo { id: Integer @pk; }
@export
logic findTodos(): List<Todo> { return Todo.all; }
interface Api { GET '/api/todos' -> findTodos }
`);
    // 程序化改坏 logicRef，测 typecheck 兜底（parser 层已强校验合法路径）
    app.interfaces[0].endpoints[0].logicRef = 'app.logics.missing';
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('接口端点悬空引用 logic'))).toBe(true);
  });

  it('passes valid CRUD logic with entity methods', () => {
    const app = parse(`
entity Todo { id: Integer @pk; title: String; done: Boolean; }
struct TodoInput { title: String; done: Boolean; }
@export
logic findTodos(): List<Todo> { return Todo.all; }
@export
logic createTodo(input: TodoInput): Todo {
  todo := new Todo();
  todo.title = input.title;
  todo.done = input.done;
  todo.save();
  return todo;
}
`);
    const r = check(app);
    expect(r.ok).toBe(true);
  });

  it('reports unknown entity method', () => {
    const app = parse(`
entity Todo { id: Integer @pk; }
@export
logic bad(): List<Todo> { Todo.nope(); return Todo.all; }
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('实体 Todo 无方法'))).toBe(true);
  });

  it('reports entity get with wrong arity', () => {
    const app = parse(`
entity Todo { id: Integer @pk; }
@export
logic bad(): Todo { return Todo.get(); }
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('需要 1 个参数'))).toBe(true);
  });
});
describe('typecheck/order-scenario', () => {
  it('allows ForEach over struct List field (input.items)', () => {
    const app = parse(`
entity Order { id: Integer @pk; customer: String; total: Decimal; }
struct OrderInput { customer: String; items: List<OrderInputItem>; }
struct OrderInputItem { product: String; price: Decimal; qty: Integer; }
@export
logic create(input: OrderInput): Order {
  order := new Order();
  order.save();
  for (it in input.items) { order.total = order.total + it.price * it.qty; }
  order.save();
  return order;
}
`);
    const r = check(app);
    expect(r.ok).toBe(true);
  });

  it('allows ForEach over Entity.where(...)', () => {
    const app = parse(`
entity Order { id: Integer @pk; }
entity OrderItem { id: Integer @pk; orderId: Integer; }
@export
logic del(id: Integer): Boolean {
  for (it in OrderItem.where(orderId = id)) { it.delete(); }
  return true;
}
`);
    const r = check(app);
    expect(r.ok).toBe(true);
  });

  it('rejects where on unknown field', () => {
    const app = parse(`
entity Order { id: Integer @pk; }
@export
logic find(id: Integer): List<Order> {
  return Order.where(unknown = id);
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('无字段'))).toBe(true);
  });

  it('rejects ForEach over undefined variable member', () => {
    const app = parse(`
entity Todo { id: Integer @pk; }
@export
logic bad(): List<Todo> {
  result := new List<Todo>();
  for (todo in something.else) { result.add(todo); }
  return result;
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('ForEach 容器'))).toBe(true);
  });
});
