---
name: tdsl-syntax
description: TDSL 语言完整语法参考（低代码 DSL，TS 词法面 + 领域关键词）。Use when 写 .tdsl 文件、忘语法、不确定某个构造怎么写、需要快速确认 entity/function/page/interface/dependency 的形态与语义。
---

# TDSL 语法（完整参考）

> 核心：**书写面用 TS 词法**（`function/const/for-of`），**骨架声明用领域关键词**（`entity/page/interface`）。
> 不是严格 TypeScript：`@pk`、`Order.where(...)` 是 TS 没有的；内置类型是领域类型（`Integer/Decimal`，**没有** `number/string`）。
> **禁止清单**（最易写错）：三元 `?:`、模板字符串、`==`（一律 `===`）、箭头函数、`class`、`:=`、`for-in`、`logic`。legacy 词法已删除，写了就报语法错误。

## 0. 一分钟示例

```
@datasource('defaultDS')

entity Todo {
  id: Integer @pk;
  title: String;
  done: Boolean;
}

@export
function listTodos(): List<Todo> {
  return Todo.all;
}

interface TodoApi {
  GET '/api/todos' -> listTodos
}

page TodoList {
  <table dataSource={useQuery('listTodos')}>
    <column field="title" />
  </table>
  <button text="新增" action={navigate('TodoCreate')} />
}
```

## 1. 顶层声明

### dependency（依赖声明，用了三方库必须先声明）

```
dependency java "g:a:v" import { JSON, JSONObject };      // import 列表：类以裸名可用
dependency java "com.fasterxml:jackson:2.17.0" as jackson; // as ns = 命名空间，调用写 jackson.JSON
dependency npm "antd@^5.21.0";                             // 纯依赖，只进 package.json
dependency npm "echarts-for-react" import ECharts;         // 默认导出组件
dependency npm "@ant-design/charts" import { Pie, Bar };   // 具名导出（一包多组件）
```

- Java 坐标 → pom.xml；npm → package.json。**未声明即用 = D-dep-1 error**。
- java 声明需要对应扫描产物在工程 `libs/*.json`（`tdsl bundle-jar <jar> -o libs/x.json` 生成）。
- `as ns` 用于同名类消解；`ns.JSON.toJSONString(...)` 引用。

### @datasource（数据源/命名空间作用域）

```
@datasource('erp')
entity Order { ... }

@datasource('crm')
entity Order { ... }          // 跨数据源同名实体可共存
```

- 独立顶层语句，之后 entity 归入当前源直到下次切换。
- 引用用短名；**跨源歧义必须写限定名** `erp.Order` / `crm.Order`（不写歧义直接报错）。

### entity（实体）

```
entity Order {
  id: Integer @pk;
  title: String;
  total: Decimal @nullable;
  status: OrderStatus;        // 枚举类型直接引用
  supplierId: Integer @ref(Supplier);               // 外键显示引用名 + 下拉
  areaId: Integer @nullable @ref(AreaDict, display: 'name');
  parentId: Integer @nullable @ref(ProductCategory); // 自引用也要显式 @ref
  createdAt: DateTime;
}
```

属性注解：`@pk`（主键，`Entity.get(id)` 的依据）/ `@nullable` / `@unique` / `@ref(实体[, display:'字段'])`。
内置标量：`Integer Decimal String Boolean Date Time DateTime`（无 number/string/Date）。

**外键铁律（编译器零推断）**：只有写了 `@ref` 才渲染引用下拉/引用名；字段名叫 `xxxId` 不算数。
`display` 缺省 `'name'`，字段不存在报 `FK-REF-DISPLAY`；目标实体需要 `query*` 返回 `List<该实体>` 作下拉源（缺 `FK-REF-NO-QUERY` warning）。

### struct / enum

```
struct OrderInput {
  title: String;
  items: List<OrderItemInput>;      // 嵌套 List 结构
}

enum OrderStatus { DRAFT, SUBMITTED }
enum DocStatus { DRAFT('暂存'), SUBMITTED('已提交') }          // KEY('中文') 显示标签
enum AuditStatus { DRAFT('暂存', 'orange'), PASS('通过', 'green') }  // 标签颜色业务声明
```

颜色白名单：`green/red/orange/blue/purple/cyan/magenta/gold/default` 或 `#hex`。

### service（外部系统对接：dubbo/http）

```
@service(kind = 'dubbo', group = 'user-center', version = '1.0.0')
service UserSvc {
  getUser(id: Integer): User;
}

@service(kind = 'http', baseUrl = 'http://erp-center')
service ErpApi {
  GET '/api/orders/{id}' -> getOrder(id: Integer): Order;    // http 必须带 METHOD + path
}
```

function 内像本地方法调：`userSvc.getUser(id)`。生成 `@DubboReference` / `@FeignClient`。
**本地 jar 类不用 service**——用 `dependency java` + libs 产物后 function 直调。

## 2. 业务逻辑 function（TS 词法面）

```
@export
function createOrder(input: OrderInput): Order {
  if (input.items.count === 0) { return null; }
  const order = new Order();
  order.total = 0;
  order.save();
  for (const it of input.items) {
    it.save();
  }
  return order;
}
```

| 形态 | 语义 |
|---|---|
| `const x = expr` / `const x: T = expr` | 变量声明（唯一形态） |
| `if (cond) {...} else {...}` | 条件；**无三元** |
| `for (const x of xs)` | 遍历 List（唯一形态） |
| `throw '仅暂存单可提交';` | 业务异常 → HTTP 400，前端弹错误提示 |
| `===` / `!==` | 相等（**无 ==**） |
| `&&` `\|\|` `!` | 逻辑 |
| `+ - * /` | 算术（Decimal 自动 BigDecimal 包装） |

### 实体方法

```
Order.get(id)                 // 静态：主键查
Order.all                     // 静态：全表（ForEach/查询链起点）
entity.save() / entity.delete()   // 实例：持久化（写操作自动事务）
```

### 查询语言

```
Order.where(total > 0)                              // 条件: = >= <= > < like in（= 是"等于"！）
Order.where(billNo like '%x%', status = status)     // 逗号 = AND；条件内可 && / ||
Order.where(...).orderBy(total desc)                // 排序（方向 asc|desc）
Order.where(...).limit(10)                          // 限条 → findTop10
Order.where(...).page(1, 20)                        // 分页 → Page<T>
Order.aggregate(sum(total))                         // 聚合: sum/avg/max/min/count
Order.aggregate(sum(total)).groupBy(customer)       // 分组 → List<Map<Object>>
```

### List / 字符串方法（FFI 内核）

```
xs.add(x)   xs.count   xs.get(i)   xs.contains(x)   xs.isEmpty
s.trim()  s.toUpperCase()  s.toLowerCase()  s.contains(x)  s.startsWith(x)  s.endsWith(x)
s.replace(a, b)  s.substring(i, j)  s.indexOf(x)  s.isEmpty  s.length
```

### @ok（操作反馈文案）

```
@export
@ok('已领取')
function takeCustomer(id: Integer): Boolean { ... }
```

按钮 `useMutation('takeCustomer', row.id)` 成功弹「已领取」；未声明统一提示「操作成功」。**业务文案写在 TDSL**，生成器只搬运。

## 3. interface（REST 契约）

```
interface OrderApi {
  GET '/api/orders' -> listOrders
  GET '/api/orders/{id}' -> getOrderDetail     // {id} 路径参数
  POST '/api/orders' -> createOrder
}
```

**页面 binding 引用的函数必须被 interface 端点暴露**，否则 typecheck 报错（防前端白屏的实战铁律）。

## 3.5 鉴权与会话（M11）

```
@auth(user: 'SystemUser', username: 'username', password: 'password',
      loginPage: 'Login', registerPage: 'Register')
```

- **整应用鉴权唯一开关**（五项缺一不可，零推断）：无 `@auth` 的应用不生成任何鉴权层；
- 登录/注册是**普通 function + interface**（端点 `/api/auth/**` 自动放行，其余 `/api/**` 一律 401）；密码用平台原语 `Auth.hash(raw, salt)` / `Auth.matches(raw, stored, salt)`（backend-only）；
- **token 签发/校验/前端会话（localStorage+authFetch+路由守卫+顶栏用户+退出）全部生成器托管，TDSL 无 token 概念**——登录 function 返回含 token/userId 的 struct 即可，token 由包装层回填；
- 页面注解 `@public` = 免登录 + 不进主布局/菜单（登录/注册页专用）；密码框 `<input field="password" type="password" />`；
- 登录/注册页的表单 submit 成功后自动跳转（登录回首页、注册回登录页）。

## 4. 页面 page / 弹窗 dialog

```
@title('销货单列表')
@menu('销售管理')                     // 顶栏模块 + 左侧菜单分组（'模块/分组' 可两级）
page SalesBillList {
  <input field="billNo" label="销货单号" />       // 查询条件区
  <table dataSource={useQuery('searchSalesBills')}>
    <column field="status" title="状态" />          // 枚举列自动彩色标签
    <button text="编辑" action={openDialog('SalesBillEdit', row)}
            disabled={row.status === DocStatus.AUDITED} />   // 已审批置灰
    <button text="审批" action={useMutation('auditSalesBill', row.id)}
            visible={row.status === DocStatus.UNAUDIT} />    // 状态互斥
    <button text="反审批" action={useMutation('deauditSalesBill', row.id)}
            visible={row.status === DocStatus.AUDITED} />
  </table>
  <button text="新增销货单" action={openDialog('SalesBillEdit')} />
}

@title('销货单编辑')
dialog SalesBillEdit {
  <form submit={useMutation('saveSalesBill')}>
    <input field="billNo" label="销货单号" />
    <repeat field="items">
      <input field="qty" label="数量" />
      <input field="price" label="单价" />
    </repeat>
    <summary field="items" expr={qty * price} label="金额合计" />  // 明细合计（实时）
    <summary field="items" of="qty" label="总数量" />              // 单字段求和
    <button text="保存" />
  </form>
}

@title('销货单详情')
dialog SalesBillDetail {
  <detail dataSource={useQuery('getSalesBillDetail', initial.id)}> // 抽屉详情：按选中行查单条
    <text field="bill.billNo" title="销货单号" />
    <repeat field="items" title="明细">                            // 详情只读子表
      <column field="goodsId" title="商品" />
      <column field="qty" title="数量" />
    </repeat>
  </detail>
  <button text="编辑" action={openDialog('SalesBillEdit', row.bill)} />
}
```

### 绑定（唯一数据通道）

| 绑定 | 语义 |
|---|---|
| `useQuery('函数名')` | 取数 → hooks 状态喂组件 |
| `useMutation('函数名', args...)` | 提交 → 成功后自动 refetch |
| `navigate('PageName', row.id)` | 页面导航 |
| `openDialog('DialogName', row)` | 打开抽屉 |

参数引用：`$route.id` 路由参数 / `row` 表格行 / 抽屉内 `initial.id` 选中行 id。

### 内置组件

```
table column button form input repeat text detail summary
tag(color) statistic(title,value) tabs > pane(title)
checkbox switch radio(options="A,B") avatar badge(count) card(title)
```

表单类型自动升级：枚举 → Select / 日期 → DatePicker / 数字 → InputNumber。

### 动作可用性与形态（企业范式）

- `visible={条件}`：不满足**不渲染**（状态互斥动作，如审批/反审批）。
- `disabled={条件}`：满足则**置灰**（保留占位）。
- text 含「删」自动 Popconfirm 二次确认。
- 页面级按钮统一放标题右侧动作区，>3 个折叠「更多」。
- 条件表达式为行上下文子集：`row.<字段>` 比较 + `EnumType.MEMBER` + `&& / || / !`。

### 表达式域（G2）

```
<input field="amount" derive={qty * price} />        // 派生：纯函数 → 计算 readOnly
<input field="goodsId" carryBy="getGoods">           // 带出：选中后回填
  <input field="goodsName" />
</input>
```

`derive` 内禁止 IO 绑定（useQuery/useMutation）；`carryBy` 指向的函数返回实体必须含全部子字段。

### 明细带出（列表直接编辑带明细）

```
<repeat field="items" dataSource={useQuery('queryErpPurchaseOrderItems', initial.id)}>
  <input field="productId" label="产品" />
  ...
</repeat>
```

优先级：查询结果 items ?? initial.items ?? 空行；新增态不发请求（守卫）。

## 5. 第三方库接入（全流程）

```
① 扫描  tdsl bundle-jar D:/x.jar -o <工程>/libs/x.json [--classes JSON,JSONObject]
② 声明  dependency java "g:a:v";          （npm 同理 dependency npm "pkg" import { Pie };）
③ 使用  function 内直调 JSON.toJSONString(o)；页面直用 <Pie />，import 自动生成
```

同名类撞 alias（fastjson/jackson 都有 JSON）→ D-dep-4 error，消解二选一：改产物 alias / `as ns` 限定。 `ns.JSON`。

## 6. 多文件工程（分片习惯）

- 目录即 app；跨文件共享全局命名空间，**实体/枚举/函数/页面名全局唯一**。
- 按功能域纵向切分片：`00-model`（枚举+实体+结构）→ `10-xx`（各业务域：逻辑+页面）→ 门户收尾。
- 每片可仅含它用的部分；同名跨源实体靠 `@datasource` 分开。
- 参照 `../demo-yudao/tdsl/` 的 8 分片组织。