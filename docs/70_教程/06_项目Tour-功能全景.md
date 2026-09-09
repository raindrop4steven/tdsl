# 06 项目 Tour：当前功能全景与源码导读

> 定位：**学习地图**。基于 2026-09-08 之后最新代码实测盘点（全部 120 单测通过），
> 把"P0 → P1 CRUD → P2 复杂逻辑 → M1/M4/M6/M2"已完成的全部能力串成一条可动手走读的 Tour。
> 前置阅读：`00_总览` ~ `05_codegen-react`（P0 逐包讲解）；本文在其上补齐 M1/M2/M4/M6 的最新进展。
> 配套代码：`packages/*`、`examples/todo-app/`。

---

## 1. 项目是什么（一段话）

**TDSL** 是自研低代码 DSL：大模型/人用 **TS 风格语法**书写 `*.tdsl` 文件（书写面）→
parser 编译为 **Typed AST**（语义核，唯一事实来源）→ typecheck 校验（引用绑定/方法/查询/页面）→
codegen 从**同一棵 AST** 确定性生成 **Spring Boot 后端**与 **React 前端**两个完整工程，双端真实 build 通过。

```
todo.tdsl ──parse──▶ Typed AST ──typecheck──▶ ok
                  (@tdsl/parser)  (@tdsl/core) (@tdsl/typecheck)
                                        │
                     ┌──────────────────┴──────────────────┐
                     ▼                                     ▼
             generateJava(app)                      generateReact(app)
             Spring Boot 工程                        Vite+React 工程
             (Entity/Repository/Service/             (api/hooks/pages/router,
              Controller/Feign 接口)                  antd 组件映射)
                     │                                     │
                mvn compile ✓                         vite build ✓
```

---

## 2. 当前进度全景（已完成 ✅）

| 里程碑 | 核心能力 | 状态 | 设计文档 |
|--------|----------|------|----------|
| P0 五包闭环 | core/parser/typecheck/codegen-java/codegen-react + Todo demo，双端真实 build | ✅ | 教程 00-05 |
| P1 CRUD | `interface` 语法、带参 Service、`@RestController`、前端真实 CRUD fetch | ✅ | dev/12 |
| P2 复杂逻辑 | 完整运算符、`List.count/add`、`Entity.where` 单条件、`@Transactional`、Decimal 算术（BigDecimal）、扁平表外键、主子表 UI | ✅ | dev/13 |
| **M1 命名空间** | 实体短名→数据源作用域、跨源同名共存、限定名 `ds.Entity`、歧义报错、logic 变量块作用域（Java 复用语义） | ✅ | dev/15 |
| **M4 View 声明层** | `page` + JSX 子集 → `ViewNode` IR、`useQuery/useMutation/navigate` 绑定、多页面路由、antd 组件映射、前端真生成 | ✅ | dev/16 |
| **M6 外部能力** | `service`（dubbo/bean/http → `@DubboReference`/`@Autowired`/`@FeignClient`）+ `component`（npm 三方组件注册与页面引用） | ✅ | dev/17 |
| **M2 查询语言** | where 复合条件（多条件 AND、`=/>=/<=/>/</like/in`、`&&/\|\|` 组合）、`.orderBy()`/`.page()`/`.limit()` 链式、`.aggregate()` 聚合 + `.groupBy()` | ✅ | dev/18 |
| **P2 LLM Prompt Pack** | 示例矩阵（5 领域样例，单测锁定可编译性）、五层 prompt 组装（角色/速查/示例/需求/输出契约）、诊断回流修复闭环（parse 行列 + typecheck nodePath → 人话化） | ✅ | dev/19 |

**实测数据**：132 个单测全绿（core 5 / parser 37 / typecheck 32 / codegen-java 28 / codegen-react 18 / llm 12）；
`npm run slice` 一键跑通 parse→typecheck→codegen→`mvn compile` + `vite build`。

### 尚未完成（演进方向）
- **M3** 逻辑语言补全 + 类型检查加深（现在 typecheck 对变量/成员是"宽松放行"策略，见 §6.3）
- **M5** 数据完整性（软删/乐观锁/级联深化）
- **P2 平台化（续）**：llm 接入真实 LLM API 与评测基准、CLI、playground、编译服务常驻（见 dev/14 路线规划、dev/19 §7）

---

## 3. 30 秒上手

```bash
npm test              # 120 个单测（五包各自 vitest）
npm run slice         # 端到端：todo.tdsl → parse → typecheck → 双端 codegen → 双端真实 build
```

产物在 `examples/todo-app/generated/`（`java/` 可 `mvn compile`，`react/` 可 `vite build`）。

---

## 4. 仓库地图（按依赖方向自底向上）

```
packages/
  core/            # 语义核：节点类型 + 符号表 + nodePath 寻址（零运行时依赖）
    src/types.ts       (204 行)  全部节点判别联合：App/DataSource/Entity/.../Service/Component/View
    src/expr.ts        (37 行)   小表达式语言 Expr（含 M2 新运算符 = like in）
    src/statement.ts   (10 行)   语句 Statement
    src/typeref.ts     (13 行)   TypeRef：primitive / reference / generic(List|Map|Page) / db
    src/symbols.ts     (100 行)  ★M1 TypeSymbolTable（分层作用域）+ VarScope（变量块作用域）
    src/path.ts        (79 行)   nodePathOf / resolve（跨节点引用寻址）
    src/id.ts          (8 行)    createNode / createId（uuid）
  parser/
    src/lexer.ts       (124 行)  分词：ident/string/number/punct/eof，带行列
    src/parser.ts      (1059 行) 递归下降 + ★linkApp（短名→nodePath 绑定）
  typecheck/
    src/index.ts       (757 行)  check(app)：五类诊断（见 §6.3）
  codegen-java/
    src/index.ts       (1543 行) generateJava：脚手架/实体/Repository/结构/Service/Controller/Feign
    src/type-map.ts    (47 行)   TypeRef → Java 类型（never 穷尽示范）
  codegen-react/
    src/index.ts       (1130 行) generateReact：工程脚手架 + M4 页面真生成（api/hooks/pages/router）
  llm/
    src/examples.ts    (★ 示例矩阵：5 领域样例，单测锁定可编译性，永不腐烂)
    src/prompt.ts      (五层 prompt 组装：角色/速查/示例/需求/输出契约)
    src/repair.ts      (诊断回流修复：validateTdsl/repairPrompt/humanizePath)
examples/todo-app/
  todo.tdsl          # ★最佳学习样本：一个文件覆盖全部已完成能力
  scripts/slice.ts   # 端到端驱动（66 行，读它就懂数据流）
  generated/         # 生成产物（java/ + react/，独立构建不进 workspace）
```

---

## 5. 最佳样本：todo.tdsl 一览（订单场景）

`examples/todo-app/todo.tdsl` 现在是订单域（不再是简单 Todo），**一个文件覆盖全部已完成能力**：

| TDSL 片段 | 展示的能力 |
|-----------|-----------|
| `@datasource('defaultDS')` + `entity Order/OrderItem` | 数据源声明；OrderItem.orderId 为**普通外键字段**（扁平表关联，无主子表概念） |
| `struct OrderInput { items: List<OrderItemInput> }` | 结构 DTO + 泛型嵌套（`List<引用结构>`） |
| `logic createOrder(...)` 里 `:=`、`if`、`for-in`、`it.price * it.qty` | TS 风格小语言（非严格 TS 子集，见设计总览 D4 口径修正）；Decimal 算术生成 BigDecimal；写操作自动 `@Transactional` |
| `Order.get(id)` / `OrderItem.where(orderId = id)` / `entity.save()` / `.delete()` | 实体静态方法 + 实例方法 |
| `interface OrderApi { GET '/api/orders/{id}' -> getOrderDetail }` | REST 契约 → Java Controller + 前端 fetch |
| `Order.where(customer like '%'+c+'%', total >= minTotal)` | M2：多条件 AND + `like` 运算符 |
| `Order.where(total > 0).orderBy(total desc).limit(10)` / `.page(n, size)` | M2：链式排序/限条/分页（返回 `Page<Order>`） |
| `Order.aggregate(sum(total)).groupBy(customer)` → `List<Map<Object>>` | M2：聚合 + 分组 |
| `page OrderList { <table dataSource={useQuery('listOrders')}>... }` | M4：声明式页面 + 数据绑定 |
| `<button action={navigate('OrderDetail', row.id)} />` | M4：页面间导航（多页面路由） |
| `<form submit={useMutation('createOrder')}> <repeat field="items">` | M4：表单提交 + 明细行编辑 |

> M1（跨源同名 `erp.Order`/`crm.Order`）和 M6（`service`/`component`）在单测里有完整样本：
> `packages/parser/test/parser.test.ts` 的 `parser/M1`、`parser/M6` describe 块。

---

## 6. 五包逐包 Tour（对照源码读）

### 6.1 core —— 语义核

**节点全家福**（`types.ts`）：`App` → 聚合 8 类域：
`datasources`(实体) / `structures` / `enums` / `logics` / `interfaces` / `views`(M4) / `services`(M6) / `components`(M6)。

M4/M6 新增节点：
```ts
ViewNode        { kind:'View', name, viewKind:'page', elements }        // page → ViewNode
ViewElementNode { type:'table'|'form'|..., props, bindings, children } // JSX 子集 → IR
BindingNode     { name:'useQuery'|'useMutation'|'navigate', target, args } // 从 props 表达式提取
ServiceNode     { kind_, 'dubbo'|'bean'|'http', config, operations }   // 外部后端能力
ComponentNode   { pkg, defaultProps, events }                          // npm 三方前端组件
```

**M1 符号表**（`symbols.ts`）——理解命名空间的关键：
- `TypeSymbolTable.global`：结构/枚举/逻辑/接口 + **全局唯一**的实体短名 → nodePath
- `TypeSymbolTable.dataSources`：`dsName → Map<实体短名, nodePath>`（实体短名归数据源作用域）
- `resolveShort(table, name, ctxDs)`：先查当前数据源作用域，再回退全局
- `resolveQualified(table, dsName, entName)`：限定名 `ds.Entity`
- `isAmbiguousEntity`：短名跨源歧义检测（书写面不写限定名就报错）
- `VarScope`：logic 内变量块作用域，**Java 复用语义**（同块同名复用、无遮蔽）

**寻址**（`path.ts`）：引用一律存 nodePath 字符串（如 `app.datasources.erp.entities.Order`），
`resolve(app, path)` 编译期绑定，悬空返回 null → typecheck 报诊断。

### 6.2 parser —— 文本 → AST

三步：`tokenize`（行列保留）→ 递归下降 `parseApp` → **`linkApp`**（短名绑定，M1 核心）。

书写面语法清单（`parseApp` 顶层分派）：
`@datasource('x')` / `entity` / `struct` / `enum` / `logic` / `interface` / `page` / `service` / `component`。

**M2 查询语言的解析技巧**（`parser.ts` 的 `parseCallArgs`，最值得精读）：
普通 `(` 后无法预知是"普通调用"还是"where 复合条件"，所以 parser 按**调用点形态分派实参解析**：
- 接收者是实体（`Order` / `erp.Order`）且方法名 `where` → `parseWhereArgs`：
  条件形如 `field op value`（op ∈ `= >= <= > < like in`），逗号分隔 = AND，
  条件内 `&&/||` 递归组合（`parseWhereCond`）。右值用 `parseAdditive`（不含比较/逻辑层，
  防止 `parseExpr` 把 `&&`/`)` 吞进值里）。
- 接收者是"查询链"（`isQueryChain` 递归判断）→ `parseChainMethodArgs`：
  `orderBy(field asc|desc, ...)` 特殊解析方向为 String 字面量参数 → `[field, 'asc', ...]`；
  `page(n,size)` / `limit(n)` / `groupBy(field,...)` 走普通参数。
- 其他 → 普通逗号分隔表达式。

数组字面量 `[1,2,3]` → `NewList`（M2 为 `in` 条件服务，元素类型按首项推断）。

**linkApp 的 M1 绑定策略**：
1. 同数据源内实体重名 → `duplicate entity` 报错
2. 全局概念（struct/enum/logic/interface/service/component）重名 → `duplicate type name` 报错
3. TypeRef 引用：`erp.Order` 限定名 / `Order` 短名（`resolveShort`，实体属性解析时带 `ctxDs` 优先本数据源）/ 歧义 → 提示写限定名 / `Object` 内建放行
4. `endpoint.logicRef` 与页面 `Binding.target`（useQuery/useMutation → logic nodePath；navigate → 页面校验）

### 6.3 typecheck —— 五类诊断

`check(app): { ok, diagnostics }`，`Diagnostic { path, line?, col?, message, severity }`：

1. **悬空引用**：遍历所有 TypeRef（含泛型参数），reference 必须 `resolve` 成功（`Object` 兜底放行）
2. **ForEach 容器**：必须是可迭代 List（实体查询 / 已知变量 / 成员访问 / Call）
3. **Interface**：每个 endpoint 的 logicRef 必须可 resolve
4. **实体方法与查询链**（`checkEntityCalls`，最大的一块）：
   - 静态：`X.get(id)` 1 参；`X.where(cond,...)` 条件字段存在 + 运算符白名单；`X.aggregate(sum(f))` 聚合白名单
   - 链式：`.orderBy/.page/.limit/.groupBy` 参数与字段校验（沿链递归找起点实体）
   - 实例：`.save()/.delete()` 无参；`list.add(x)`/`list.count` 接收者须是 List
   - 外部服务：`userService.getUser(id)` 按"接收者小驼峰 = service 短名"匹配（M6），核对方法存在与参数个数
5. **View**（M4/M6）：组件类型 ∈ 内置集合 或 已注册 component；binding 的 logic/页面必须存在

> **设计取舍（当前策略）**：typecheck 对"变量/成员表达式"是**宽松放行**（无法静态推导就通过），
> 把误报率压到零、报错率留给确定场景。完整类型推导/泛型统一在 **M3** 切面补（dev/11 已有设计）。

### 6.4 codegen-java —— 同一棵 AST → Spring Boot

`generateJava(app): GeneratedFile[]` 产出完整工程：

| 生成物 | 来源 | 关键机制 |
|--------|------|----------|
| `pom.xml`、`TodoApplication.java`、`application.yml` | 脚手架 | H2 + web + data-jpa + openfeign |
| `entity/Order.java` | Entity | `@Entity/@Table/@Id/@Column`，SQL 保留字表名加引号 |
| `repository/OrderRepository.java` | 实体查询 | ★**QuerySpec 机制**（下述） |
| `structure/Xxx.java` | Structure | POJO + getter/setter，引用实体自动补 import |
| `service/OrderService.java` | Logic | 每逻辑一个方法；含 `.save()/.delete()` 自动 `@Transactional` |
| `controller/OrderApiController.java` | Interface | `@RestController` + 路径参数 `{id}` → `@PathVariable` |
| `service/api/UserService.java` | service (M6) | dubbo/bean → 普通接口；**http → `@FeignClient(name, url)`** |

**QuerySpec 机制**（`collectQuerySpecs`，M2 的核心）：扫描所有 logic 的实体查询表达式 →
每个实体归集出若干"查询形态"（条件集 + 排序 + 分页/聚合/分组）→ 去重（`sameSpec`）→
每个 QuerySpec 生成一个 Repository 方法：
- 派生方法名：`findByCustomerLikeAndTotalGreaterThanOrderByTotalDesc`（`opSuffix` 映射运算符后缀）
- `limit(n)` → `findTop{n}By...`
- `.page(n,size)` → 方法带 `Pageable` 参数，返回 `org.springframework.data.domain.Page<T>`
- 聚合 → `@Query("select sum(o.total) from Order o ...")` JPQL；`.groupBy` → 返回 `List<Map<String,Object>>`

表达式翻译：`===`→`equals`、`&&`→`&&`、Decimal 算术自动 `BigDecimal.valueOf(...)` 包装、
`null`/布尔/字符串字面量直译。`logic` 方法体是**逐语句翻译**（`genStatement`/`genExpr`），
非固定模板——这是"非固定模板生成"能力的底气。

### 6.5 codegen-react —— M4 前端真生成

有 `views` 时走 `viewAppFiles`（多页面真生成），产出：

```
src/api.ts          # 每个 endpoint → 一个 fetch 函数（路径参数/GET query 参数拼装）
src/hooks.ts        # useQuery/useMutation（真实实现，非占位）
src/pages/<Page>.tsx    # 每个 page → 一个组件
src/App.tsx         # react-router 路由表（根路径重定向到首个页面防白屏）
```

**从 binding 到 hooks**：parser 已把 `dataSource={useQuery('listOrders')}` 提取成 `BindingNode`；
codegen 收集每个页面的 query/mutation/navigate 绑定 →
生成 `const q = useQuery(() => listOrders(), [])` 状态 + 把 `q.data` 喂给组件。

**ViewElement → antd 组件映射**（`ANTD_OF`）：

| TDSL 元素 | 生成 |
|-----------|------|
| `<table dataSource={...}>` | `<Table columns=...>` + column.field → 数据驱动列；行内 `<button>` → 操作列 |
| `<button action={useMutation(...)}>` / `navigate(...)` | `<Button onClick={...}>`（mutation 后自动 refetch 关联 query） |
| `<form submit={useMutation(...)}>` + `<input field=...>` | 受控表单，字段 useState 自动提升到组件顶部 |
| `<repeat field="items">` | 嵌套明细行编辑（`repeatItemStruct` 反查结构类型） |
| `<text field="order.customer" />` | `<span>{data.order.customer}</span>` |
| `<detail dataSource={...}>` | antd `<Descriptions>` |
| 第三方 component（M6） | `genComponentElement`：import npm 组件、dataSource → `data={q.data}`、其余 prop 透传 |

**路由与 `$route`**：`routePathOf` 把页面名转 kebab-case（`OrderList` → `/orders`）；
binding 参数引用 `$route.id` → 路径自动加 `:id` 段，表达式翻译为 `Number(params.id)`。

无 `views` 时退回固定模板 `appFile`（兼容旧用例）。

---

## 7. 一条逻辑的完整旅程（以 `topOrders` 为例）

```ts
logic topOrders(): List<Order> {
  return Order.where(total > 0).orderBy(total desc).limit(10);
}
```

1. **parser**：`parsePostfix` 逐层包成 `Call(Member(Call(...orderBy...), 'limit'), [10])`；
   `where` 分派进 `parseWhereArgs` → `Binary('>', Ident('total'), 0)`；
   `orderBy(total desc)` → args `[Ident('total'), String('desc')]`
2. **linkApp**：`Order` 短名 → `app.datasources.defaultDS.entities.Order`
3. **typecheck**：`checkEntityCalls` 识别查询链起点实体为 Order；`total` 字段存在；
   `>` 在运算符白名单；`orderBy` 方向合法；`limit` 恰 1 参
4. **codegen-java**：`querySpecOf` 提取 QuerySpec{conditions:[total>0], orderBy:[total desc], limit:10} →
   `List<Order> findTop10ByTotalGreaterThan(Long total);`，Service 方法体翻译为
   `return orderRepository.findTop10ByTotalGreaterThan(0L);`
5. **codegen-react**：`topOrders` 若被某 page 的 `useQuery` 引用 → `api.ts` 生成 fetch 函数，组件里
   `useQuery(() => topOrders())`；数据喂给 antd Table

同一条 TDSL，两个消费端语义一致——这就是 D1「Typed AST 是唯一事实来源」的直观体现。

---

## 8. 三条铁律在代码里的落点

| 铁律 | 落点示范 |
|------|----------|
| 判别联合 + `never` 穷尽 | `type-map.ts` 的 `javaType` 末尾 `const _never: never = tr`；新增节点不改生成器 → TS 直接编译报错 |
| nodePath 引用 + resolve | `types.ts` 里 `Endpoint.logicRef`/`Binding.target`/`TypeRef.reference.path` 全是字符串路径；`path.ts` 提供双向寻址 |
| 纯函数 / 确定性 | 所有 `generate*` 返回 `GeneratedFile[]` 不碰磁盘；写盘在 `slice.ts`；同输入必同输出，可快照 diff |

---

## 9. 推荐学习路径

1. **先跑**：`npm run slice` + `npm test`，建立直觉
2. **读样本**：`examples/todo-app/todo.tdsl`（对照 §5 的能力表，逐段问"这段会变成什么"）
3. **读驱动**：`scripts/slice.ts`（66 行，整条流水线）
4. **顺依赖读码**（对照 §6 的函数索引）：
   `core/types.ts` → `core/symbols.ts` → `parser/parser.ts`（重点 `parseCallArgs`/`linkApp`）→
   `typecheck/index.ts`（重点 `checkEntityCalls`）→ `codegen-java/index.ts`（重点 `collectQuerySpecs`/`genStatement`）→
   `codegen-react/index.ts`（重点 `pageFile`/`genTable`）
5. **对照设计文档**：dev/15（M1）→ dev/16（M4）→ dev/17（M6）→ dev/18（M2），每篇都有验收标准与单测对应
6. **动手改**：
   - 在 todo.tdsl 里给 `Order` 加一个 `createdAt: DateTime` 字段，看双端各生成什么
   - 写一个新 page（如 `OrderStats`），用 `useQuery('orderStats')`，跑 slice 看 antd 组件生成
   - 故意把 `where(total > 0)` 写成 `where(totl > 0)`，观察 typecheck 诊断与 nodePath
   - 加第二个数据源 `@datasource('crm')` + 同名实体，体会 M1 限定名与歧义报错

---

## 10. 与项目级文档的偏差提示

- `docs/dev/14` 的"现状盘点"写于 M1 前（当时 51 单测、M1 建议为"下一步"）；现在 M1/M2/M4/M6/Prompt Pack 已落地。
- 类型定义的 SSoT 是 `packages/core/src/types.ts`；`docs/10_设计/设计总览.md` 只保留速览。
- JSON AST 序列化 / zod / schema 包：范围外（见设计总览 D1 范围决策），语义核即事实来源。
