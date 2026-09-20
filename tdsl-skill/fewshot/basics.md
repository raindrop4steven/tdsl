# few-shot：基础示例（单测锁定可编译）

> 来源：`packages/llm/src/examples.ts`（示例矩阵）——每个都是 compile 全绿的完整 TDSL，作为单测常驻锁定（防示例腐烂）。照着抄就不会有低级语法错。
> 进阶（企业范式）见同目录 `patterns-yudao.md`；完整工程参照 `../demo-yudao/`。

## 1. CRUD 单表（最小全套）

实体/结构/逻辑/接口/页面 全套最小形态（列表 + 表单 + 增删改查）。

```ts
// CRUD 单表：全套最小形态
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
function listTodos(): List<Todo> {
  return Todo.all;
}

@export
function createTodo(input: TodoInput): Todo {
  const todo = new Todo();
  todo.title = input.title;
  todo.done = input.done;
  todo.save();                        // 实例方法：save() / delete()
  return todo;
}

@export
function updateDone(id: Integer, done: Boolean): Todo {
  const todo = Todo.get(id);               // 主键查
  todo.done = done;
  todo.save();
  return todo;
}

@export
function deleteTodo(id: Integer): Boolean {
  const todo = Todo.get(id);
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
```

## 2. 主子表 / 外键关联（订单）

扁平表外键、嵌套 List 结构、for-of 明细写入、Decimal 算术、事务、详情页 + repeat 表单。

```ts
// 订单（扁平表 + 外键关联）：OrderItem.orderId 是普通外键字段
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
function createOrder(input: OrderInput): Order {
  if (input.items.count === 0) {
    return null;
  }
  const order = new Order();
  order.customer = input.customer;
  order.total = 0;
  order.save();                       // 写操作 logic 自动 @Transactional
  for (const it of input.items) {
    const item = new OrderItem();
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
function getOrderDetail(id: Integer): OrderDetail {
  const order = Order.get(id);
  const detail = new OrderDetail();
  detail.order = order;
  detail.items = OrderItem.where(orderId = id);      // where 单条件（字段 = 值）
  return detail;
}

@export
function deleteOrder(id: Integer): Boolean {
  const order = Order.get(id);
  for (const it of OrderItem.where(orderId = id)) {
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
function listOrders(): List<Order> {
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
```

## 3. 查询报表（where 复合 / 链式 / 聚合）

where 复合（like/in/&&/||）、orderBy/page/limit、聚合 sum/count + groupBy、Page<T>/Map 返回。

```ts
// 查询报表：where 复合条件 / 链式 / 聚合
@datasource('defaultDS')

entity Order {
  id: Integer @pk;
  customer: String;
  total: Decimal;
  status: String;
}

@export
function searchOrders(customer: String, minTotal: Decimal): List<Order> {
  return Order.where(customer like '%' + customer + '%', total >= minTotal);
  //                            ↑ like 运算符（领域 DSL，非 TS）     ↑ 逗号 = AND
}

@export
function topOrders(): List<Order> {
  return Order.where(total > 0).orderBy(total desc).limit(10);
  //                            ↑ 链式：orderBy 方向 asc|desc、limit 截条
}

@export
function pageOrders(n: Integer, size: Integer): Page<Order> {
  return Order.where(total > 0).orderBy(total desc).page(n, size);   // 返回 Page<Order>
}

@export
function orderStats(): Decimal {
  return Order.aggregate(sum(total));          // 聚合：sum/avg/max/min/count
}

@export
function sumByCustomer(): List<Map<Object>> {
  return Order.aggregate(sum(total)).groupBy(customer);   // 分组聚合 → List<Map<Object>>
}

@export
function statusCount(): List<Order> {
  return Order.where(status in ['A', 'B']);    // in + 数组字面量
}

@export
function orQuery(): List<Order> {
  return Order.where(total > 100 || status = 'C');   // 条件内 || 组合（注意：= 是"等于"，非赋值）
}

interface OrderQueryApi {
  GET '/api/orders/search'          -> searchOrders
  GET '/api/orders/top'             -> topOrders
  GET '/api/orders/page'            -> pageOrders
  GET '/api/orders/stats'           -> orderStats
  GET '/api/orders/sum-by-customer' -> sumByCustomer
}
```

## 4. 外部服务 / 三方组件（service + dependency）

service（dubbo/http）声明与调用、dependency npm 一等公民（页面直用三方组件）。

```ts
// 外部能力接入：service（dubbo/http）+ dependency 一等公民
// 本地 jar 类不走 service——dependency java 声明 + libs 产物后 function 直调（dev/33）
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
function listOrders(): List<Order> {
  return Order.all;
}

@service(kind = 'dubbo', group = 'user-center', version = '1.0.0')
service UserService {
  getUser(id: Integer): User;
  listUsers(): List<User>;
}

@service(kind = 'http', baseUrl = 'http://erp-center')
service ErpApi {
  GET '/api/orders/{id}' -> getOrder(id: Integer): Order;
}

@export
function syncUser(id: Integer): User {
  const user = userService.getUser(id);    // 像调本地方法：接收者 = 服务短名的小驼峰
  return user;
}

@export
function pullErpOrder(id: Integer): Order {
  return erpApi.getOrder(id);         // http 服务 → 生成 @FeignClient
}

interface OrderApi {
  GET '/api/orders' -> listOrders
  GET '/api/orders/stats' -> orderStats
}

dependency npm "echarts-for-react" import ECharts;   // npm 一等公民：默认导出组件，页面直接 <ECharts />

page Dashboard {
  <table dataSource={useQuery('listOrders')}> </table>
  <ECharts dataSource={useQuery('orderStats')} />   // 三方组件直接用，import 由声明解析
}

@export
function orderStats(): Decimal {
  return Order.aggregate(sum(total));
}
```

## 5. 多数据源 / 命名空间

跨数据源同名实体、dsName.Entity 限定名引用、歧义短名报错。

```ts
// 多数据源：实体短名归数据源作用域，跨源同名合法
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
function mergeOrder(erpId: Integer, crmId: Integer): Shipment {
  const e = erp.Order.get(erpId);          // 静态方法同样支持限定名
  const c = crm.Order.get(crmId);
  const s = new Shipment();
  s.erpOrder = e;
  s.crmOrder = c;
  return s;
}
// 注意：只写 Order（无限定名）时，若短名跨数据源歧义 → 编译报错提示加限定名
```