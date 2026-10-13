# few-shot: basics (unit-test-locked, compilable)

> [中文](basics.md) · **English**

> Source: `packages/llm/src/examples.ts` (the example matrix) — each is a complete TDSL that compiles green, permanently locked by unit tests (guards against example rot). Copy them and you won't hit low-level syntax errors.
> Advanced (enterprise patterns) live in `patterns-yudao.en.md` in the same directory; a full project reference is in `../demo-yudao/`.

## 1. CRUD single table (minimal full set)

The minimal full form of entity/struct/logic/interface/page (list + form + create/read/update/delete).

```ts
// CRUD single table: minimal full form
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
  todo.save();                        // instance methods: save() / delete()
  return todo;
}

@export
function updateDone(id: Integer, done: Boolean): Todo {
  const todo = Todo.get(id);               // lookup by primary key
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
    <button text="Delete" action={useMutation('deleteTodo', row.id)} />
  </table>
  <button text="New" action={navigate('TodoCreate')} />
}

page TodoCreate {
  <form submit={useMutation('createTodo')}>
    <input field="title" />
    <button text="Submit" />
  </form>
}
```

## 2. Master-detail / foreign-key association (order)

Flat-table foreign keys, nested List structs, for-of line-item writes, Decimal arithmetic, transactions, a detail page + repeat form.

```ts
// Order (flat tables + FK association): OrderItem.orderId is an ordinary FK field
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
  items: List<OrderItemInput>;        // nested List struct
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
  order.save();                       // write logic is auto @Transactional
  for (const it of input.items) {
    const item = new OrderItem();
    item.orderId = order.id;
    item.product = it.product;
    item.price = it.price;
    item.qty = it.qty;
    item.save();
    order.total = order.total + it.price * it.qty;   // Decimal arithmetic → BigDecimal
  }
  order.save();
  return order;
}

@export
function getOrderDetail(id: Integer): OrderDetail {
  const order = Order.get(id);
  const detail = new OrderDetail();
  detail.order = order;
  detail.items = OrderItem.where(orderId = id);      // where single condition (field = value)
  return detail;
}

@export
function deleteOrder(id: Integer): Boolean {
  const order = Order.get(id);
  for (const it of OrderItem.where(orderId = id)) {
    it.delete();                      // delete line items first
  }
  order.delete();                     // cascade-delete the master
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
    <button text="Detail" action={navigate('OrderDetail', row.id)} />
    <button text="Delete" action={useMutation('deleteOrder', row.id)} />
  </table>
  <button text="New Order" action={navigate('OrderCreate')} />
}

page OrderCreate {
  <form submit={useMutation('createOrder')}>
    <input field="customer" />
    <repeat field="items">            // line-item row editing (items → OrderItemInput)
      <input field="product" />
      <input field="price" />
      <input field="qty" />
    </repeat>
    <button text="Submit" />
  </form>
}

page OrderDetail {
  <detail dataSource={useQuery('getOrderDetail', $route.id)}>
    <text field="order.customer" />
    <text field="order.total" />
  </detail>
}
```

## 3. Query / report (compound where / chaining / aggregation)

Compound where (like/in/&&/||), orderBy/page/limit, aggregation sum/count + groupBy, Page<T>/Map returns.

```ts
// Query/report: compound where conditions / chaining / aggregation
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
  //                            ↑ like operator (domain DSL, not TS)     ↑ comma = AND
}

@export
function topOrders(): List<Order> {
  return Order.where(total > 0).orderBy(total desc).limit(10);
  //                            ↑ chaining: orderBy direction asc|desc, limit truncates rows
}

@export
function pageOrders(n: Integer, size: Integer): Page<Order> {
  return Order.where(total > 0).orderBy(total desc).page(n, size);   // returns Page<Order>
}

@export
function orderStats(): Decimal {
  return Order.aggregate(sum(total));          // aggregate: sum/avg/max/min/count
}

@export
function sumByCustomer(): List<Map<Object>> {
  return Order.aggregate(sum(total)).groupBy(customer);   // grouped aggregation → List<Map<Object>>
}

@export
function statusCount(): List<Order> {
  return Order.where(status in ['A', 'B']);    // in + array literal
}

@export
function orQuery(): List<Order> {
  return Order.where(total > 100 || status = 'C');   // || inside a condition (note: = means "equals", not assignment)
}

interface OrderQueryApi {
  GET '/api/orders/search'          -> searchOrders
  GET '/api/orders/top'             -> topOrders
  GET '/api/orders/page'            -> pageOrders
  GET '/api/orders/stats'           -> orderStats
  GET '/api/orders/sum-by-customer' -> sumByCustomer
}
```

## 4. External services / third-party components (service + dependency)

Declaring and calling service (dubbo/http); dependency npm as a first-class citizen (use third-party components directly in pages).

```ts
// External capability integration: service (dubbo/http) + dependency as first-class
// Local jar classes do NOT use service — declare dependency java + libs artifact, then call directly (dev/33)
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
  const user = userService.getUser(id);    // like a local method: receiver = lowerCamelCase of the service short name
  return user;
}

@export
function pullErpOrder(id: Integer): Order {
  return erpApi.getOrder(id);         // http service → generates @FeignClient
}

interface OrderApi {
  GET '/api/orders' -> listOrders
  GET '/api/orders/stats' -> orderStats
}

dependency npm "echarts-for-react" import ECharts;   // npm first-class: default-exported component, use <ECharts /> directly in a page

page Dashboard {
  <table dataSource={useQuery('listOrders')}> </table>
  <ECharts dataSource={useQuery('orderStats')} />   // third-party component used directly; imports resolved from declarations
}

@export
function orderStats(): Decimal {
  return Order.aggregate(sum(total));
}
```

## 5. Multiple data sources / namespaces

Same-named entities across data sources, `dsName.Entity` qualified references, ambiguous short names erroring.

```ts
// Multiple data sources: entity short names belong to a data-source scope; same name across sources is legal
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
  erpOrder: erp.Order;                // qualified name dsName.EntityName (cross-source same-name must qualify)
  crmOrder: crm.Order;
}

@export
function mergeOrder(erpId: Integer, crmId: Integer): Shipment {
  const e = erp.Order.get(erpId);          // static methods also support qualified names
  const c = crm.Order.get(crmId);
  const s = new Shipment();
  s.erpOrder = e;
  s.crmOrder = c;
  return s;
}
// Note: when you write just Order (unqualified) and the short name is ambiguous across data sources → a compile error tells you to qualify it.
```
