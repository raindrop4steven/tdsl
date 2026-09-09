/**
 * 示例矩阵（Prompt Pack ③层，教学主体）。
 *
 * 设计约束（dev/19 §5.2）：
 * - 每个示例都是**可编译的 TDSL**（parse + typecheck 全绿），作为单测常驻锁定，防示例腐烂。
 * - 示例带行内注释标注"偏离点"（:= / for-in / 领域 DSL），LLM 对注释敏感。
 * - 完整领域样例优先于碎片片段（研究结论：LLM 从自洽样例归纳模式 >> 记忆离散规则）。
 */

export interface ExampleMeta {
  id: string;
  domain: string;
  description: string;
  keywords: string[];
}

export interface Example extends ExampleMeta {
  tdsl: string;
}

export const EXAMPLES: Example[] = [
  {
    id: 'crud-single-table',
    domain: 'CRUD 单表',
    description: '实体/结构/逻辑/接口/页面 全套最小形态（增删改查 + 列表页 + 表单页）',
    keywords: ['crud', '单表', '列表', '表单', '增删改查', 'todo', '管理'],
    tdsl: `// CRUD 单表：全套最小形态
@datasource('defaultDS')
entity Todo {
  id: Integer @pk;
  title: String;
  done: Boolean;
}

struct TodoInput {
  title: String;
  done: Boolean;
}

@export
logic listTodos(): List<Todo> {
  return Todo.all;
}

@export
logic createTodo(input: TodoInput): Todo {
  todo := new Todo();                 // 偏离点：:= 声明（无 let/const）
  todo.title = input.title;
  todo.done = input.done;
  todo.save();                        // 实例方法：save() / delete()
  return todo;
}

@export
logic updateDone(id: Integer, done: Boolean): Todo {
  todo := Todo.get(id);               // 主键查
  todo.done = done;
  todo.save();
  return todo;
}

@export
logic deleteTodo(id: Integer): Boolean {
  todo := Todo.get(id);
  todo.delete();
  return true;
}

interface TodoApi {
  GET    '/api/todos'      -> listTodos
  POST   '/api/todos'      -> createTodo
  PUT    '/api/todos/{id}' -> updateDone
  DELETE '/api/todos/{id}' -> deleteTodo
}

page TodoList {
  <table dataSource={useQuery('listTodos')}>
    <column field="id" />
    <column field="title" />
    <column field="done" />
    <button text="删除" action={useMutation('deleteTodo', row.id)} />
  </table>
  <button text="新增" action={navigate('TodoCreate')} />
}

page TodoCreate {
  <form submit={useMutation('createTodo')}>
    <input field="title" />
    <button text="提交" />
  </form>
}
`,
  },
  {
    id: 'master-detail-order',
    domain: '主子表/外键关联',
    description: '扁平表外键、嵌套 List 结构、for-in 明细写入、Decimal 算术、事务、详情页 + repeat 表单',
    keywords: ['订单', '主子表', '外键', '明细', 'order', '事务', 'repeat'],
    tdsl: `// 订单（扁平表 + 外键关联）：OrderItem.orderId 是普通外键字段
@datasource('defaultDS')
entity Order {
  id: Integer @pk;
  customer: String;
  total: Decimal;
  status: String;
}

entity OrderItem {
  id: Integer @pk;
  orderId: Integer;
  product: String;
  price: Decimal;
  qty: Integer;
}

struct OrderInput {
  customer: String;
  items: List<OrderItemInput>;        // 嵌套 List 结构
}

struct OrderItemInput {
  product: String;
  price: Decimal;
  qty: Integer;
}

struct OrderDetail {
  order: Order;
  items: List<OrderItem>;
}

@export
logic createOrder(input: OrderInput): Order {
  if (input.items.count === 0) {
    return null;
  }
  order := new Order();
  order.customer = input.customer;
  order.total = 0;
  order.save();                       // 写操作 logic 自动 @Transactional
  for (it in input.items) {           // 偏离点：in 遍历元素（语义同 for-of）
    item := new OrderItem();
    item.orderId = order.id;
    item.product = it.product;
    item.price = it.price;
    item.qty = it.qty;
    item.save();
    order.total = order.total + it.price * it.qty;   // Decimal 算术 → BigDecimal
  }
  order.save();
  return order;
}

@export
logic getOrderDetail(id: Integer): OrderDetail {
  order := Order.get(id);
  detail := new OrderDetail();
  detail.order = order;
  detail.items = OrderItem.where(orderId = id);      // where 单条件（字段 = 值）
  return detail;
}

@export
logic deleteOrder(id: Integer): Boolean {
  order := Order.get(id);
  for (it in OrderItem.where(orderId = id)) {
    it.delete();                      // 先删明细
  }
  order.delete();                     // 级联删除主表
  return true;
}

interface OrderApi {
  GET    '/api/orders'      -> listOrders
  POST   '/api/orders'      -> createOrder
  GET    '/api/orders/{id}' -> getOrderDetail
  DELETE '/api/orders/{id}' -> deleteOrder
}

@export
logic listOrders(): List<Order> {
  return Order.all;
}

page OrderList {
  <table dataSource={useQuery('listOrders')}>
    <column field="id" />
    <column field="customer" />
    <column field="total" />
    <button text="详情" action={navigate('OrderDetail', row.id)} />
    <button text="删除" action={useMutation('deleteOrder', row.id)} />
  </table>
  <button text="新增订单" action={navigate('OrderCreate')} />
}

page OrderCreate {
  <form submit={useMutation('createOrder')}>
    <input field="customer" />
    <repeat field="items">            // 明细行编辑（items → OrderItemInput）
      <input field="product" />
      <input field="price" />
      <input field="qty" />
    </repeat>
    <button text="提交" />
  </form>
}

page OrderDetail {
  <detail dataSource={useQuery('getOrderDetail', $route.id)}>
    <text field="order.customer" />
    <text field="order.total" />
  </detail>
}
`,
  },
  {
    id: 'query-report',
    domain: '查询报表',
    description: 'where 复合条件（like/in/&&/||）、链式 orderBy/page/limit、聚合 sum/count + groupBy、Page<T>/Map 返回',
    keywords: ['查询', '报表', '统计', '分页', '排序', '聚合', '搜索', 'report'],
    tdsl: `// 查询报表：where 复合条件 / 链式 / 聚合
@datasource('defaultDS')
entity Order {
  id: Integer @pk;
  customer: String;
  total: Decimal;
  status: String;
}

@export
logic searchOrders(customer: String, minTotal: Decimal): List<Order> {
  return Order.where(customer like '%' + customer + '%', total >= minTotal);
  //                            ↑ like 运算符（领域 DSL，非 TS）     ↑ 逗号 = AND
}

@export
logic topOrders(): List<Order> {
  return Order.where(total > 0).orderBy(total desc).limit(10);
  //                            ↑ 链式：orderBy 方向 asc|desc、limit 截条
}

@export
logic pageOrders(n: Integer, size: Integer): Page<Order> {
  return Order.where(total > 0).orderBy(total desc).page(n, size);   // 返回 Page<Order>
}

@export
logic orderStats(): Decimal {
  return Order.aggregate(sum(total));          // 聚合：sum/avg/max/min/count
}

@export
logic sumByCustomer(): List<Map<Object>> {
  return Order.aggregate(sum(total)).groupBy(customer);   // 分组聚合 → List<Map<Object>>
}

@export
logic statusCount(): List<Order> {
  return Order.where(status in ['A', 'B']);    // in + 数组字面量
}

@export
logic orQuery(): List<Order> {
  return Order.where(total > 100 || status = 'C');   // 条件内 || 组合（注意：= 是"等于"，非赋值）
}

interface OrderQueryApi {
  GET '/api/orders/search'          -> searchOrders
  GET '/api/orders/top'             -> topOrders
  GET '/api/orders/page'            -> pageOrders
  GET '/api/orders/stats'           -> orderStats
  GET '/api/orders/sum-by-customer' -> sumByCustomer
}
`,
  },
  {
    id: 'external-service',
    domain: '外部服务/三方组件',
    description: 'service（dubbo/bean/http 三种）声明与调用、component（npm 组件）注册与页面引用',
    keywords: ['外部', '服务', 'dubbo', 'http', 'feign', '组件', 'echarts', 'component', '集成'],
    tdsl: `// 外部能力接入：service + component
entity User {
  id: Integer @pk;
  name: String;
}

entity Order {
  id: Integer @pk;
  customer: String;
  total: Decimal;
}

@export
logic listOrders(): List<Order> {
  return Order.all;
}

@service(kind = 'dubbo', group = 'user-center', version = '1.0.0')
service UserService {
  getUser(id: Integer): User;
  listUsers(): List<User>;
}

@service(kind = 'bean', jar = 'com.example:order-sdk:1.0')
service OrderSdk {
  createOrder(input: Order): Order;
}

@service(kind = 'http', baseUrl = 'http://erp-center')
service ErpApi {
  GET '/api/orders/{id}' -> getOrder(id: Integer): Order;
}

@export
logic syncUser(id: Integer): User {
  user := userService.getUser(id);    // 像调本地方法：接收者 = 服务短名的小驼峰
  return user;
}

@export
logic pullErpOrder(id: Integer): Order {
  return erpApi.getOrder(id);         // http 服务 → 生成 @FeignClient
}

interface OrderApi {
  GET '/api/orders' -> listOrders
}

component ECharts {
  pkg: 'echarts-for-react';           // npm 包名
  defaultProps: { option: Json; style: Json };
  events: ['onClick'];
}

page Dashboard {
  <table dataSource={useQuery('listOrders')}> </table>
  <ECharts dataSource={useQuery('orderStats')} />   // 三方组件参与数据绑定
}

@export
logic orderStats(): Decimal {
  return Order.aggregate(sum(total));
}
`,
  },
  {
    id: 'multi-datasource',
    domain: '多数据源/命名空间',
    description: '跨数据源同名实体、dsName.Entity 限定名引用、歧义短名报错',
    keywords: ['多数据源', 'erp', 'crm', '跨库', '同名', '命名空间', '限定'],
    tdsl: `// 多数据源：实体短名归数据源作用域，跨源同名合法
@datasource('erp')
entity Order {
  id: Integer @pk;
  amount: Decimal;
}

@datasource('crm')
entity Order {
  id: Integer @pk;
  customer: String;
}

struct Shipment {
  erpOrder: erp.Order;                // 限定名 dsName.EntityName（跨源同名必须限定）
  crmOrder: crm.Order;
}

@export
logic mergeOrder(erpId: Integer, crmId: Integer): Shipment {
  e := erp.Order.get(erpId);          // 静态方法同样支持限定名
  c := crm.Order.get(crmId);
  s := new Shipment();
  s.erpOrder = e;
  s.crmOrder = c;
  return s;
}
// 注意：只写 Order（无限定名）时，若短名跨数据源歧义 → 编译报错提示加限定名
`,
  },
];

export function listExamples(): ExampleMeta[] {
  return EXAMPLES.map(({ tdsl: _tdsl, ...meta }) => meta);
}

/** 按域选择示例：显式 domains 命中 > 默认顺序取前 N 个（调用方明确指定域时用） */
export function selectExamples(domains: string[], max: number): Example[] {
  const wanted = domains.map((d) => d.toLowerCase());
  const matched = EXAMPLES.filter((e) => {
    const hay = [e.id, e.domain, ...e.keywords].join(' ').toLowerCase();
    return wanted.some((w) => hay.includes(w));
  });
  const pool = matched.length > 0 ? matched : EXAMPLES;
  return pool.slice(0, max);
}

/** 从需求文本自动匹配域关键词（示例检索器的规则层；后续可换向量检索） */
export function autoMatchExamples(requirement: string, max: number): Example[] {
  const text = requirement.toLowerCase();
  const matched = EXAMPLES.filter((e) =>
    e.keywords.some((k) => text.includes(k.toLowerCase())),
  );
  const pool = matched.length > 0 ? matched : EXAMPLES;
  return pool.slice(0, max);
}
