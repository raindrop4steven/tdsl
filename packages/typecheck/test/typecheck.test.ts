import { describe, expect, it } from 'vitest';
import { createNode, type AppNode, type DataSourceNode, type EntityNode } from '@tdsl/core';
import { parse, parseProject } from '@tdsl/parser';
import { check } from '../src/index';

const GOOD = `
@datasource('defaultDS')
entity Todo {
  id: Integer @pk;
  title: String;
  done: Boolean;
}

@export
function findTodos(): List<Todo> {
  const result = new List<Todo>();
  for (const todo of Todo.all) {
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
      views: [],
      services: [],
      dependencies: [],
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
function bad(): List<Todo> {
  const result = new List<Todo>();
  for (const todo of something.else) { result.add(todo); }
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
function findTodos(): List<Todo> { return Todo.all; }
interface Api { GET '/api/todos' -> findTodos }
`);
    // 程序化改坏 logicRef，测 typecheck 兜底（parser 层已强校验合法路径）
    app.interfaces[0].endpoints[0].logicRef = 'app.logics.missing';
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('接口端点悬空引用 logic'))).toBe(true);
  });

  it('passes valid CRUD function with entity methods', () => {
    const app = parse(`
entity Todo { id: Integer @pk; title: String; done: Boolean; }
struct TodoInput { title: String; done: Boolean; }
@export
function findTodos(): List<Todo> { return Todo.all; }
@export
function createTodo(input: TodoInput): Todo {
  const todo = new Todo();
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
function bad(): List<Todo> { Todo.nope(); return Todo.all; }
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('实体 Todo 无方法'))).toBe(true);
  });

  it('reports entity get with wrong arity', () => {
    const app = parse(`
entity Todo { id: Integer @pk; }
@export
function bad(): Todo { return Todo.get(); }
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
function create(input: OrderInput): Order {
  const order = new Order();
  order.save();
  for (const it of input.items) { order.total = order.total + it.price * it.qty; }
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
function del(id: Integer): Boolean {
  for (const it of OrderItem.where(orderId = id)) { it.delete(); }
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
function find(id: Integer): List<Order> {
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
function bad(): List<Todo> {
  const result = new List<Todo>();
  for (const todo of something.else) { result.add(todo); }
  return result;
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('ForEach 容器'))).toBe(true);
  });
});

describe('typecheck/M1 namespace', () => {
  it('resolves qualified entity in expression (erp.Order.all)', () => {
    const app = parse(`
@datasource('erp')
entity Order { id: Integer @pk; }
@datasource('crm')
entity Order { id: Integer @pk; }
@export
function listErp(): List<erp.Order> {
  return erp.Order.all;
}
`);
    const r = check(app);
    expect(r.ok).toBe(true);
  });

  it('rejects unknown qualified entity method', () => {
    const app = parse(`
@datasource('erp')
entity Order { id: Integer @pk; }
@export
function bad(): List<erp.Order> {
  return erp.Order.nope();
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('无方法'))).toBe(true);
  });

  it('ForEach over qualified where query', () => {
    const app = parse(`
@datasource('erp')
entity Order { id: Integer @pk; }
@datasource('erp')
entity OrderItem { id: Integer @pk; orderId: Integer; }
@export
function del(id: Integer): Boolean {
  for (const it of erp.OrderItem.where(orderId = id)) { it.delete(); }
  return true;
}
`);
    const r = check(app);
    expect(r.ok).toBe(true);
  });
});

describe('typecheck/M4 view', () => {
  it('passes valid page with bindings', () => {
    const app = parse(`
entity Order { id: Integer @pk; customer: String; }
@export
function listOrders(): List<Order> { return Order.all; }
@export
function deleteOrder(id: Integer): Boolean { return true; }
interface OrderApi {
  GET    '/api/orders'      -> listOrders
  DELETE '/api/orders/{id}' -> deleteOrder
}
page OrderList {
  <table dataSource={useQuery('listOrders')}>
    <column field="id" />
    <button text="删" action={useMutation('deleteOrder', row.id)} />
  </table>
  <button text="新增" action={navigate('OrderCreate')} />
}
page OrderCreate { }
`);
    const r = check(app);
    expect(r.ok).toBe(true);
  });

  it('rejects unknown view element type（三方组件未匹配 dependency npm）', () => {
    const app = parse(`
entity Order { id: Integer @pk; }
@export
function listOrders(): List<Order> { return Order.all; }
page X { <fancy dataSource={useQuery('listOrders')} /> }
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('未匹配到 dependency npm'))).toBe(true);
  });

  it('rejects dangling binding logic', () => {
    const app = parse(`
entity Order { id: Integer @pk; }
@export
function listOrders(): List<Order> { return Order.all; }
page X { <table dataSource={useQuery('listOrders')}><column field="id" /></table> }
`);
    // 程序化改坏 binding target 测 typecheck 兜底
    app.views[0].elements[0].bindings[0].target = 'app.logics.missing';
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('悬空逻辑引用'))).toBe(true);
  });

  it('rejects function without interface endpoint（agent 忘写 interface → api.ts 缺函数 → 前端白屏，编译期拦截）', () => {
    const app = parse(`
entity Car { id: Integer @pk; plate: String; }
@export
function listCars(): List<Car> { return Car.all; }
page CarList {
  <table dataSource={useQuery('listCars')}><column field="plate" /></table>
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('没有 interface 端点暴露该逻辑'))).toBe(true);
  });

  it('passes function exposed via interface endpoint', () => {
    const app = parse(`
entity Car { id: Integer @pk; plate: String; }
@export
function listCars(): List<Car> { return Car.all; }
interface CarApi { GET '/api/cars' -> listCars }
page CarList {
  <table dataSource={useQuery('listCars')}><column field="plate" /></table>
}
`);
    expect(check(app).ok).toBe(true);
  });

  it('管理端常用组件（tag/statistic/tabs/switch/badge/card）不再视为未知类型', () => {
    const app = parse(`
entity Car { id: Integer @pk; plate: String; }
@export
function stats(): Decimal { return Car.aggregate(count(id)); }
@export
function listCars(): List<Car> { return Car.all; }
interface CarApi { GET '/api/cars' -> listCars GET '/api/cars/stats' -> stats }
page Dashboard {
  <statistic title="总数" value={qStats.data} />
  <tabs>
    <pane title="车辆">
      <tag color="green" text="在租" />
      <avatar text="张" />
    </pane>
    <pane title="明细">
      <switch field="on" />
      <checkbox field="agree" />
      <radio field="type" options="A,B" />
      <badge count={qStats.data} text="告警" />
      <card title="卡" />
    </pane>
  </tabs>
}
`);
    const r = check(app);
    expect(r.diagnostics.filter((d) => d.message.includes('未知页面组件类型'))).toEqual([]);
  });

it('rejects dangling navigate page', () => {
    const app = parse(`
entity Order { id: Integer @pk; }
@export
function listOrders(): List<Order> { return Order.all; }
page X { <button text="a" action={navigate('Y')} /> }
page Y { }
`);
    // navigate 绑定改坏（parser 已校验合法，测 typecheck 兜底）
    app.views[0].elements[0].bindings[0].target = 'Nope';
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('悬空页面'))).toBe(true);
  });
});

describe('typecheck/M6 service + component', () => {
  it('passes valid service plus function calls', () => {
    const app = parse(`
entity Order { id: Integer @pk; customer: String; }
@export
function createOrder(input: Order): Order {
  return userService.createOrder(input);
}
@service(kind = 'dubbo', group = 'order-center')
service UserService {
  createOrder(input: Order): Order;
}
`);
    const r = check(app);
    expect(r.ok).toBe(true);
  });

  it('rejects unknown service method', () => {
    const app = parse(`
entity Order { id: Integer @pk; customer: String; }
@export
function createOrder(input: Order): Order {
  return userService.nope(input);
}
@service(kind = 'dubbo')
service UserService {
  createOrder(input: Order): Order;
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('无方法 nope'))).toBe(true);
  });

  it('rejects service call with wrong arg count', () => {
    const app = parse(`
entity Order { id: Integer @pk; customer: String; }
@export
function createOrder(input: Order): Order {
  return userService.createOrder();
}
@service(kind = 'dubbo')
service UserService {
  createOrder(input: Order): Order;
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('需要 1 个参数'))).toBe(true);
  });

  it('rejects http service operation without method/path', () => {
    const app = parse(`
@service(kind = 'http')
service ErpApi {
  getOrder(id: Integer): Order;
}
entity Order { id: Integer @pk; }
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes("必须声明 METHOD 'path'"))).toBe(true);
  });

  it('三方组件由 dependency npm 匹配（dev/33 一等公民）', () => {
    const app = parse(`
dependency npm "echarts-for-react" import ECharts;
entity Order { id: Integer @pk; customer: String; }
@export
function listOrders(): List<Order> { return Order.all; }
interface OrderApi { GET '/api/orders' -> listOrders }
page P {
  <ECharts option={null} dataSource={useQuery('listOrders')} />
}
`);
    const r = check(app);
    expect(r.ok).toBe(true);
  });

  it('rejects unregistered view element type（无 dependency 命中）', () => {
    const app = parse(`
entity Order { id: Integer @pk; customer: String; }
@export
function listOrders(): List<Order> { return Order.all; }
page P {
  <Nope dataSource={useQuery('listOrders')} />
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('未匹配到 dependency npm'))).toBe(true);
  });
});

describe('typecheck/M2 查询语言', () => {
  it('passes where 多条件 + 链式 + aggregate + groupBy', () => {
    const app = parse(`
@datasource('d')
entity Order {
  id: Integer @pk;
  customer: String;
  total: Decimal;
  status: String;
}
@export
function searchOrders(customer: String, minTotal: Decimal): List<Order> {
  return Order.where(customer like '%' + customer + '%', total >= minTotal);
}
function topOrders(): List<Order> {
  return Order.where(total > 0).orderBy(total desc).limit(10);
}
function pageOrders(n: Integer, size: Integer): Page<Order> {
  return Order.where(total > 0).orderBy(total desc).page(n, size);
}
function orderStats(): Decimal {
  return Order.aggregate(sum(total));
}
function sumByCustomer(): List<Map<Object>> {
  return Order.aggregate(sum(total)).groupBy(customer);
}
`);
    const r = check(app);
    expect(r.ok).toBe(true);
  });

  it('rejects where 字段不存在', () => {
    const app = parse(`
@datasource('d')
entity Order { id: Integer @pk; total: Decimal; }
@export
function bad(): List<Order> {
  return Order.where(totalX > 0);
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('无字段 totalX'))).toBe(true);
  });

  it('rejects where 非法运算符（parser 层）', () => {
    expect(() =>
      parse(`
@datasource('d')
entity Order { id: Integer @pk; total: Decimal; }
@export
function bad(): List<Order> {
  return Order.where(total === 0);
}
`),
    ).toThrow(/field op value/);
  });

  it('rejects orderBy 字段不存在', () => {
    const app = parse(`
@datasource('d')
entity Order { id: Integer @pk; total: Decimal; }
@export
function bad(): List<Order> {
  return Order.where(total > 0).orderBy(customerX asc);
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('不存在') && d.message.includes('customerX'))).toBe(true);
  });

  it('rejects page 参数个数错误', () => {
    const app = parse(`
@datasource('d')
entity Order { id: Integer @pk; total: Decimal; }
@export
function bad(): Page<Order> {
  return Order.where(total > 0).page(1);
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('.page() 需要 2 个参数'))).toBe(true);
  });

  it('rejects aggregate 非法函数', () => {
    const app = parse(`
@datasource('d')
entity Order { id: Integer @pk; total: Decimal; }
@export
function bad(): Decimal {
  return Order.aggregate(mean(total));
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes("不支持聚合函数 'mean'"))).toBe(true);
  });

  it('rejects groupBy 字段不存在', () => {
    const app = parse(`
@datasource('d')
entity Order { id: Integer @pk; total: Decimal; customer: String; }
@export
function bad(): List<Map<Object>> {
  return Order.aggregate(sum(total)).groupBy(customerX);
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('不存在') && d.message.includes('customerX'))).toBe(true);
  });

  it('rejects 实体查询链上未知方法', () => {
    const app = parse(`
@datasource('d')
entity Order { id: Integer @pk; total: Decimal; }
@export
function bad(): List<Order> {
  return Order.where(total > 0).frobnicate();
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('查询链无方法'))).toBe(true);
  });
});

describe('typecheck/M7 多文件工程', () => {
  it('诊断带 file：跨文件悬空类型引用定位到引用所在文件', () => {
    const app = parseProject([
      { path: 'a.tdsl', content: "@datasource('d')\nentity Order { id: Integer @pk; total: Decimal; }\n" },
      { path: 'b.tdsl', content: "function bad(): List<Order> {\n  return Order.where(nofield > 0);\n}\n" },
    ]);
    const r = check(app);
    expect(r.ok).toBe(false);
    const d = r.diagnostics.find((x) => x.message.includes('nofield'));
    expect(d).toBeDefined();
    expect(d?.file).toBe('b.tdsl');
  });

  it('诊断带 file：未知查询链方法定位到所在文件', () => {
    const app = parseProject([
      { path: '01_model.tdsl', content: "@datasource('d')\nentity Order { id: Integer @pk; total: Decimal; }\n" },
      { path: '02_query.tdsl', content: "function bad(): List<Order> {\n  return Order.where(total > 0).frobnicate();\n}\n" },
    ]);
    const r = check(app);
    expect(r.ok).toBe(false);
    const d = r.diagnostics.find((x) => x.message.includes('查询链无方法'));
    expect(d?.file).toBe('02_query.tdsl');
  });

  it('单文件 parse：诊断 file 为 <stdin>', () => {
    const app = parse("@datasource('d')\nentity Order { id: Integer @pk; total: Decimal; }\nfunction bad(): List<Order> {\n  return Order.where(nofield > 0);\n}\n");
    const r = check(app);
    const d = r.diagnostics.find((x) => x.message.includes('nofield'));
    expect(d?.file).toBe('<stdin>');
  });
});

describe('typecheck FFI 目录（dev/27 Java 一等公民）', () => {
  it('链式 FFI 成员可解析：String 链 ret 传播、List.push（js 同构）不报错', () => {
    const app = check(parse(`
@datasource('defaultDS')
@export
function tag(code0: String): String {
  const a = code0.trim();
  const b = a.toUpperCase();
  const r = new List<String>();
  for (const i of r) {
    r.contains(b);
  }
  return b;
}
`));
    const errs = app.diagnostics.filter((d) => d.severity === 'error');
    expect(errs).toEqual([]);
  });

  it('目录外成员报 error，并附补录口径提示（bundle-jar）', () => {
    const app = check(parse(`
@datasource('defaultDS')
@export
function f(s: String): String {
  return s.frobnicate();
}
`));
    const d = app.diagnostics.find((x) => x.message.includes('不在 FFI 目录'));
    expect(d).toBeDefined();
    expect(d!.message).toContain('bundle-jar');
  });

  it('静态/实例错配报错：实例调静态方法(error) / 静态调静态成员 ✓', () => {
    const errApp = check(parse(`
@datasource('defaultDS')
@export
function f(d: Date): Boolean {
  d.now();
  return true;
}
`));
    const e = errApp.diagnostics.find((x) => x.message.includes('是静态方法'));
    expect(e).toBeDefined();

    const okApp = check(parse(`
@datasource('defaultDS')
@export
function g(): Integer {
  const y: Date = Date.now();
  const n: Integer = y.getYear();
  return n;
}
`));
    expect(okApp.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('未知 receiver 宽松放行（M3 之前不收紧）', () => {
    const app = check(parse(`
@datasource('defaultDS')
entity Order { id: Integer @pk; remark: String; }
@export
function f(o: Order): Order {
  const s = o.remark.trim();
  o.save();
  return o;
}
`));
    const errs = app.diagnostics.filter((d) => d.severity === 'error');
    expect(errs).toEqual([]);
  });
});

describe('typecheck G2 表达式域（dev/29）', () => {
  it('derive：纯函数 √ / IO 绑定 ✗ / 未声明叶子 ✗', () => {
    const okApp = check(parse(`
@datasource('defaultDS')
@export
function f(): Boolean { return true; }
interface Api { GET '/api/f' -> f }
page P {
  <form submit={useMutation('f')}>
    <input field="qty" />
    <input field="price" />
    <input field="amount" derive={qty * price} />
    <input field="flag" derive={row.initialFlag} />
  </form>
}
`));
    expect(okApp.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);

    const ioApp = check(parse(`
@datasource('defaultDS')
@export
function saveX(): Boolean { return true; }
interface Api { POST '/api/x' -> saveX }
page P {
  <form submit={useMutation('saveX')}>
    <input field="qty" />
    <input field="bad" derive={useMutation('saveX')} />
  </form>
}
`));
    expect(ioApp.diagnostics.some((d) => d.message.includes('derive 是纯函数表达式'))).toBe(true);

    const unknownApp = check(parse(`
@datasource('defaultDS')
@export
function saveX2(): Boolean { return true; }
interface Api2 { POST '/api/x2' -> saveX2 }
page P {
  <form submit={useMutation('saveX2')}>
    <input field="x1" derive={x1 * mysteryValue} />
  </form>
}
`));
    expect(unknownApp.diagnostics.some((d) => d.message.includes("derive 引用了未声明名 'mysteryValue'"))).toBe(true);
  });

  it('carryBy：logic 缺失 ✗ / 返回实体缺带出字段 ✗ / 正常 √', () => {
    const base = `
@datasource('defaultDS')
entity Goods { id: Integer @pk; goodsName: String; spec: String; }
@export
function getGoods(id: Integer): Goods { return Goods.get(id); }
interface Api { GET '/api/goods/{id}' -> getGoods }
`;
    const okApp = check(parse(base + `
@export
function save(input: Integer): Boolean { return true; }
page P {
  <form submit={useMutation('save')}>
    <input field="goodsId" carryBy="getGoods">
      <input field="goodsName" />
    </input>
  </form>
}
`));
    expect(okApp.diagnostics.some((d) => d.message.includes("carryBy") && d.severity === 'error')).toBe(false);

    const missApp = check(parse(base + `
@export
function save(): Boolean { return true; }
page P {
  <form submit={useMutation('save')}>
    <input field="goodsId" carryBy="getNonExist" />
  </form>
}
`));
    expect(missApp.diagnostics.some((d) => d.message.includes('指向不存在的 logic'))).toBe(true);

    const badFieldApp = check(parse(base + `
@export
function save(): Boolean { return true; }
page P {
  <form submit={useMutation('save')}>
    <input field="goodsId" carryBy="getGoods">
      <input field="nope" />
    </input>
  </form>
}
`));
    expect(badFieldApp.diagnostics.some((d) => d.message.includes('带出不可达'))).toBe(true);
  });
});

describe('typecheck dev/30 A1 throw', () => {
  it('logic 内 throw 字符串消息通过；未编目成员的 throw 消息沿 FFI 报', () => {
    const r = check(parse(`
@datasource('defaultDS')
@export
function f(x: Integer): Boolean {
  if (x === 0) { throw 'x 不能为 0'; }
  return true;
}
`));
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('typecheck dev/32 依赖声明与目录一致性', () => {
  const LIB: Parameters<typeof check>[1] extends never ? never : import('@tdsl/core').LoadedCatalog = {
    eco: 'java',
    coordinate: 'com.alibaba:fastjson2:2.0.58',
    classes: [
      {
        class: 'com.alibaba.fastjson2.JSON',
        alias: 'JSON',
        members: [{ name: 'toJSONString', static: true, params: ['Object'], ret: 'String' }],
      },
    ],
  };

  it('D-dep-1：用了产物类但未声明依赖 → error 提示补声明', () => {
    const r = check(parse(`
dependency java "other.lib:1.0";
@export
function f(o: Object): String { return JSON.toJSONString(o); }
`), { libs: [LIB] });
    expect(r.diagnostics.some((d) => d.severity === 'error' && d.message.includes('未声明依赖') && d.message.includes('fastjson2'))).toBe(true);
  });

  it('声明 + libs 匹配 → 调用通过且无依赖诊断', () => {
    const r = check(parse(`
dependency java "com.alibaba:fastjson2:2.0.58";
@export
function f(o: Object): String { return JSON.toJSONString(o); }
`), { libs: [LIB] });
    expect(r.diagnostics).toEqual([]);
  });

  it('D-dep-2：声明无产物 → warning 带 bundle-jar 口径', () => {
    const r = check(parse(`
dependency java "g.missing:1.0";
@export
function f(): Boolean { return true; }
`), { libs: [] });
    const d = r.diagnostics.find((x) => x.message.includes('无匹配扫描产物'));
    expect(d?.severity).toBe('warning');
    expect(d?.message).toContain('bundle-jar');
  });

  it('D-dep-3：声明版本与产物版本漂移 → warning', () => {
    const r = check(parse(`
dependency java "com.alibaba:fastjson2:2.0.57";
@export
function f(): Boolean { return true; }
`), { libs: [LIB] });
    const d = r.diagnostics.find((x) => x.message.includes('版本漂移'));
    expect(d?.severity).toBe('warning');
    expect(d?.message).toContain('2.0.57');
  });

  it('D-dep-4：同名类撞 alias → error 列双方坐标并给消解口径', () => {
    const other: import('@tdsl/core').LoadedCatalog = {
      eco: 'java',
      coordinate: 'g.other:1.0',
      classes: [{ class: 'g.other.JSON', alias: 'JSON', members: [] }],
    };
    const r = check(parse(`
dependency java "com.alibaba:fastjson2:2.0.58";
dependency java "g.other:1.0";
@export
function f(): Boolean { return true; }
`), { libs: [LIB, other] });
    const d = r.diagnostics.find((x) => x.message.includes('类别名 JSON'));
    expect(d?.severity).toBe('error');
    expect(d?.message).toContain('as <ns>');
  });

  it('as ns 限定调用：成员校验 + 静态/实例错配报错', () => {
    const good = check(parse(`
dependency java "com.alibaba:fastjson2:2.0.58" as fj;
@export
function f(o: Object): String { return fj.JSON.toJSONString(o); }
`), { libs: [LIB] });
    expect(good.diagnostics).toEqual([]);

    const bad = check(parse(`
dependency java "com.alibaba:fastjson2:2.0.58" as fj;
@export
function f(o: Object): Boolean { fj.JSON.toJSONString(o); return true; }
`), { libs: [{ ...LIB, classes: [{ ...LIB.classes[0]!, members: [{ name: 'toJSONString', params: ['Object'], ret: 'String' }] }] }] });
    expect(bad.diagnostics.some((d) => d.message.includes('实例方法'))).toBe(true);
  });

  it('目录外成员报 error 并附 bundle-jar 补录口径（产物形态）', () => {
    const r = check(parse(`
dependency java "com.alibaba:fastjson2:2.0.58";
@export
function f(o: Object): Object { return JSON.nope(o); }
`), { libs: [LIB] });
    const d = r.diagnostics.find((x) => x.message.includes('不在 FFI 目录'));
    expect(d?.severity).toBe('error');
    expect(d?.message).toContain('bundle-jar');
  });

  it('summary 结构校验：field 未匹配同表单 repeat → SUMMARY-TARGET', () => {
    const r = check(parse(`
entity Order { id: Integer @pk; total: Decimal; }
struct OrderInput { id: Integer; total: Decimal; }
@export
function saveOrder(input: OrderInput): Order { const o = new Order(); o.total = input.total; o.save(); return o; }
dialog orderForm {
  <form submit={useMutation('saveOrder')}>
    <input field="total" label="金额" />
    <summary field="items" of="count" label="总数量" />
  </form>
}
`));
    expect(r.diagnostics.some((d) => d.code === 'SUMMARY-TARGET')).toBe(true);
  });

  it('summary 结构校验：of/expr 均缺失 → SUMMARY-EXPR', () => {
    const r = check(parse(`
entity Order { id: Integer @pk; total: Decimal; }
struct OrderInput { id: Integer; items: List<ItemInput>; }
struct ItemInput { count: Decimal; }
@export
function saveOrder(input: OrderInput): Order { const o = new Order(); o.save(); return o; }
dialog orderForm {
  <form submit={useMutation('saveOrder')}>
    <repeat field="items"><input field="count" label="数量" /></repeat>
    <summary field="items" label="合计" />
  </form>
}
`));
    expect(r.diagnostics.some((d) => d.code === 'SUMMARY-EXPR')).toBe(true);
  });

  it('summary 合法（field 匹配 + of）→ 无 SUMMARY 诊断', () => {
    const r = check(parse(`
entity Order { id: Integer @pk; total: Decimal; }
struct OrderInput { id: Integer; items: List<ItemInput>; }
struct ItemInput { count: Decimal; }
@export
function saveOrder(input: OrderInput): Order { const o = new Order(); o.save(); return o; }
dialog orderForm {
  <form submit={useMutation('saveOrder')}>
    <repeat field="items"><input field="count" label="数量" /></repeat>
    <summary field="items" of="count" label="总数量" />
  </form>
}
`));
    expect(r.diagnostics.some((d) => d.code.startsWith('SUMMARY'))).toBe(false);
  });
});
