# 14 路线规划：TDSL 对标 NASL 的能力差距与前后端演进路线

> 关联：`00_参考资料/NASL调研.md`（NASL 领域覆盖）、`10_需求设计`（P0/P1/P2）、`20_系统设计`（架构）、`30_详细设计`（类型/算法）
> 状态：**规划中** — 对齐 NASL 领域覆盖，评估 TDSL 能否满足任意前后端需求，规划命名空间与前后端路线
> 日期：2026-09-08

---

## 1. 为什么写这份规划

TDSL 已从 P0（五包闭环 + Todo demo）走到 P1（CRUD + 复杂逻辑 + 事务 + Decimal 算术 + where 查询），
验证了"非固定模板生成"可行。接下来要回答两个方向性问题：

1. **对标 NASL**：TDSL 离 NASL 的领域覆盖还差多少？哪些是必补、哪些按需裁剪？
2. **能力边界**：TDSL 到底能不能满足项目**任意**的前后端需求？不能的话缺口在哪、怎么补？

本规划给出：现状盘点 → NASL 差距矩阵 → 前后端各自演进路线 → 命名空间/作用域决策 → 分阶段路线图。

---

## 2. 现状盘点（2026-09-08）

### 2.1 已完成

| 里程碑 | 内容 | 状态 |
|--------|------|------|
| P0 五包闭环 | core / parser / typecheck / codegen-java / codegen-react + Todo demo，26 单测，双端 build | ✅ |
| P1 CRUD | `interface` 语法、带参 Service、Controller、真实 CRUD fetch | ✅ |
| P2 复杂逻辑 | 运算符补齐（`- * / > >=`）、List 方法（count/add）、`Entity.where(field=value)` → `findByXxx`、`@Transactional`、Decimal 算术（BigDecimal add/multiply）、扁平表外键关联、级联删除、主子表 UI | ✅ 51 单测 |

### 2.2 已实现能力

- **类型**：`Integer/Decimal/String/Boolean/Date/Time/DateTime`、`List<T>`、`Map`、`Page`、结构/枚举/实体引用。
- **表达式**：完整算术/比较/逻辑（`+ - * / < <= > >= === !== && ||`）、成员访问、调用、`new`、字面量。
- **语句**：`return`、`if/else`、`for-in`、`:=` 声明、赋值、调用语句。
- **实体方法**：`X.all`、`X.get(id)`、`X.where(field=value)`、`entity.save()`、`entity.delete()`。
- **接口**：`interface` + `GET/POST/PUT/DELETE` endpoint → `@RestController`。
- **事务**：写操作 logic 自动 `@Transactional`。
- **前端**：Interface 驱动的 CRUD/主子表页面（列表 + 表单 + 明细行 + 详情 + 删除）。

### 2.3 明确缺口（本规划重点）

- **命名空间/作用域**：短名**全局唯一**，重名直接报错（`linkApp` 的 `declareName`）。跨数据源同名实体、局部作用域变量都不支持。
- **前端 View 声明层**：页面是"固定模板 + 数据填充"，**没有 ViewNode/page 声明语法**，无法声明式描述页面结构。
- **类型检查深度**：`typecheck` 目前是"最小检查"（悬空引用 + 实体方法 + ForEach 容器 + where 字段），
  没有完整类型推导/子类型/泛型统一/隐式转换（P1-typecheck 切面 `docs/dev/11` 已设计但未实现）。
- **查询能力**：只有等值 `where`，无 `and/or` 复合条件、排序、分页、聚合、联表。
- **外部能力接入**：无 `service`（Dubbo/Bean/HTTP）与 `component`（第三方组件）声明层——无法在主航道调用第三方能力（§6）。
- **流程/审批**：NASL 覆盖，TDSL 未做。
- **LLM 集成层**：`llm` / `cli` / `playground` 包未建。

---

## 3. 对标 NASL：领域覆盖差距矩阵

> 参考 `00_参考资料/NASL调研.md` §6/§7（继承/组合图）与 §4（命名空间）。

| NASL 领域 | TDSL 现状 | 差距 | 优先级 |
|-----------|----------|------|--------|
| **数据源/实体** | ✅ `@datasource` + `entity` + `@pk/@nullable/@unique` | 缺 `EntityIndex`、默认值 `DefaultValue` | P1 |
| **结构/枚举** | ✅ `struct` + `enum` | 基本齐 | — |
| **逻辑（业务方法）** | ✅ 命令式小语言 + 实体方法 + 事务 | 缺 `While`/`Break`/`Continue`/`Unary`/`Index`/字符串方法 | P1 |
| **接口（REST）** | ✅ `interface` + 4 方法 | 缺 `PATCH`、`basePath`、多返回 | P1 |
| **查询语言** | 🟡 仅等值 `where` | NASL 有 `QuerySelect/Join/Aggregate/OrderBy/GroupBy/Limit`、OQL | **P1 重点** |
| **页面 View** | ❌ 固定模板 | NASL 有 `View/ViewElement/Page/Binding` 声明树 | **P1 重点** |
| **事件/交互** | ❌ 无 | NASL `CallEvent`/`TriggerEvent` | P2 |
| **流程/审批** | ❌ 无 | NASL `Process/ApprovalPolicy` 家族 | P2 按需裁剪 |
| **权限** | ❌ 无 | NASL `PermissionForSharedScope`/`AuthLogic` | P2 按需裁剪 |
| **内置函数库** | ❌ 无 | NASL `nasl.util/collection/string/datetime/math...` | P1 起步（String/Collection） |
| **UI 组件库** | ❌ 无 | NASL `nasl.ui`（pc/h5/mp 分端） | P2 |
| **外部能力接入** | ❌ 无 | NASL `CallInterface/CallMicroservice/Connector`（Dubbo/Feign/SDK） | **P1 主航道** |
| **第三方组件** | ❌ 无 | NASL `nasl.ui` 组件库 + 扩展组件（`components.lcapLogin`） | **P1 主航道** |
| **错误处理/校验** | 🟡 仅类型检查 | NASL `ValidationRule`/`ValidationRule` | P1 |
| **JSON AST 序列化** | ❌ 范围外（需求决策） | — | 不补（保留扩展能力） |

### 结论（对标 NASL）

TDSL 在**后端数据模型 + 业务逻辑 + REST** 已接近 NASL 核心，但两大战略缺口：
1. **查询语言**（NASL 的 Query* 家族）——复杂业务查询的根基。
2. **页面 View 声明层**（NASL 的 View/ViewElement/Binding）——前端"真生成"的前提，也是"满足任意前端需求"的关键。

其余（流程/审批/权限/UI 组件/外部集成）NASL 有但**按业务裁剪**，不是第一优先。

---

## 4. 后端演进路线（Java）

### 4.1 命名空间 / 作用域（**当前最大设计缺口，先行决策**）

现状：`linkApp` 全局 `Map<name,path>`，重名抛错。无法表达"两个数据源都有 Order"或局部作用域。

**决策：数据源级作用域（推荐）**——数据源是天然的作用域边界：

```
实体/结构/枚举：作用域 = 数据源（显式限定 `defaultDS.Order`，缺省按"当前数据源优先 + 全局唯一兜底"）
逻辑：作用域 = app（全局唯一，endpoint 绑定短名）
局部变量：作用域 = logic 方法体（`:=` 声明后可见）
```

实现要点：
- `linkApp` 改为**分层符号表**：`dataSource → Map<name,path>`，顶层结构/枚举在全局表。
- `resolve` 支持短名（当前作用域优先）与限定名（`dsName.entityName`）。
- 重名规则：**同数据源内**重名报错（禁止歧义）；**跨数据源**不报错（作用域隔离）。
- typecheck/codegen 的 `entityNameOfIdent`/`findEntityByName` 需要感知当前数据源上下文。
- 书写面语法：引用跨源实体用 `erp.Order`（限定名）；同源/唯一短名可省略。

> 参考 NASL：`app.dataSources.defaultDS.entities.Student` 即"数据源为作用域段"的 nodePath 形态，TDSL 对齐此形态但保留短名书写糖。

### 4.2 查询语言（P1 重点）

在 `Entity.where(...)` 基础上扩展为**链式查询**：

```ts
// 目标书写面（对齐 NASL Query* 家族，但保持 TS 风格）
OrderItem.where(orderId = id).orderBy(qty desc).limit(10);
Order.where(customer like '%张%').and(total >= 100);
OrderDetail.aggregate(sum(total)).groupBy(customer);
```

- `where`：支持 `and`/`or`、复合条件（`like`、`>=`、`in`）。
- 排序：`.orderBy(field asc|desc)` → `findByXxxOrderByXxxAsc` 派生查询。
- 分页：`.page(n, size)` → `Page<T>` + `Pageable`。
- 聚合：`sum/avg/max/min/count` + `groupBy` → Repository `@Query` JPQL。
- 实现：codegen-java 的 Repository 生成器从"等值派生方法"升级为"复合查询生成"。

### 4.3 逻辑语言补全（P1）

- 语句：`While`、`Break`、`Continue`、`Block`（嵌套作用域）。
- 表达式：`Unary(! -)`、`Index a[i]`、字符串方法（`contains/startsWith/length`）。
- 泛型：`Map<K,V>` 遍历、`Page<T>` 返回。
- 多返回：`ReturnNode` 已支持多返回声明，补 codegen。

### 4.4 事务与数据完整性（P1）

- 已有 `@Transactional`（写操作自动）。补：
  - 实体级联（`OrderItem.orderId` 外键 → `@ManyToOne`/`@OneToMany` 或显式级联删除）。
  - 软删除/乐观锁（`@Version`）/审计字段（`createdAt/updatedAt`）——按企业规范。
- 查询方法泛化：Repository 生成器统一入口。

### 4.5 后端 P2（按需裁剪）

- 流程/审批（`Process/ApprovalPolicy`）、权限（`@PreAuthorize`/角色）、外部接口调用（Feign/HTTP）、消息。

---

## 5. 前端演进路线（React）

> 关键认知：前端现状是"固定模板 + 数据填充"，**不是真生成**。要从"满足任意前端需求"出发，必须引入**页面 View 声明层**。

### 5.1 页面 View 声明层（P1 重点，前端最大缺口）

引入 `page`/`view` 声明语法，让 TDSL 描述页面结构，codegen-react 按声明构建 UI：

```ts
// 目标书写面（对齐详细设计 §4 的 ViewNode，TSX 风格子集）
page OrderList {
  <table dataSource={useQuery('listOrders')}>
    <column field="customer" />
    <column field="total" />
    <button action={useMutation('deleteOrder')}>删除</button>
  </table>
}

page OrderCreate {
  <form submit={useMutation('createOrder')}>
    <input field="customer" />
    <repeat field="items">
      <input field="product" /><input field="price" /><input field="qty" />
    </repeat>
  </form>
}
```

- IR：`ViewNode`/`ViewElementNode`/`BindingNode`（详细设计 §4 已定义，未实现）。
- parser：`page` 关键字 + JSX 子集语法。
- codegen-react：按 ViewNode 生成 React 组件（表格/表单/明细/按钮 → 对应组件），
  替换现有"固定模板"，实现**声明式前端生成**。
- 数据绑定：`dataSource={useQuery(...)}` → 生成 axios/fetch + hooks + 状态管理。

### 5.2 路由与多页面（P1）

- 多 `page` → React Router 路由表（列表页/详情页/表单页）。
- 页面导航（`navigate('OrderDetail', { id })`）。

### 5.3 组件库抽象（P1 起步 + P2 扩充）

- `ViewElement` 类型映射到组件库（table/form/input/button/select/date...）——抽象层，可换 Ant Design 等。
- 内置 UI 组件目录（对齐 NASL `nasl.ui`，按需裁剪）。
- **第三方组件**：`component` 注册声明（§6.2），与内置组件同构进入 `ViewElement`——P1 主航道。

### 5.4 前端状态与交互（P2）

- 表单校验（`ValidationRule`）、加载态/错误态、事件（点击/变更/提交）。
- 复杂交互（弹窗/抽屉/选项卡/分页）在 ViewElement 里用 `type` 区分。

---

## 6. 外部能力接入设计（主航道一等公民）

> 定位：**不是逃生舱，是 DSL 一等公民**。后端要能调用任意 Jar SDK / Dubbo / 本地 Spring Bean / HTTP 服务；
> 前端要能引入任意第三方 npm 组件并参与数据绑定。所有能力通过**声明式接口**进入主航道，
> 由 codegen 生成真实的注入/装配代码。

### 6.1 后端：外部服务声明（对齐 NASL `CallInterface`/`Connector`）

新增顶层概念 **`service`（外部服务声明）**——把"外部能力"描述成可调用接口，logic 里像调本地方法一样调用：

```ts
// ---- 调用 Dubbo 服务（对齐 NASL CallMicroserviceInterface）----
@service(kind = 'dubbo', group = 'order-center', version = '1.0.0')
service UserService {
  getUser(id: Integer): UserDto;            // 生成 @DubboReference 注入
  listUsers(ids: List<Integer>): List<UserDto>;
}

// ---- 调用本地 Jar SDK / Spring Bean（对齐 NASL CallConnector/ConnectorLogic）----
@service(kind = 'bean', bean = 'orderSdk')
service OrderSdk {
  createOrder(input: OrderInput): OrderResult;   // 生成 @Autowired OrderSdk 注入
}

// ---- 调用 HTTP/REST 服务（对齐 NASL CallInterface）----
@service(kind = 'http', baseUrl = 'http://erp-center', timeout = 3000)
service ErpApi {
  GET '/api/orders/{id}' -> getOrder(id: Integer): OrderDto;   // 生成 FeignClient/RestClient
}

// ---- logic 里直接调用，与本地方法无差别 ----
@export
logic createOrderAndNotify(input: OrderInput): Order {
  order := createOrder(input);               // 本地 logic
  user := userService.getUser(order.customerId);   // Dubbo
  erpApi.postOrder(order);                    // HTTP
  return order;
}
```

**IR**：新增 `ServiceNode`（含 `kind: 'dubbo'|'bean'|'http'`、`group/version/bean/baseUrl` 等配置、
`operations: ServiceOperationNode[]`——方法与签名）。`ServiceNode` 加入 `AppNode.services` 与 `AnyNode` 判别联合。

**codegen-java 映射**：

| TDSL `service` kind | Java 生成 |
|---------------------|----------|
| `dubbo` | `@DubboReference` 注入接口 + `import org.apache.dubbo.config.annotation.DubboReference` |
| `bean` | `@Autowired` 注入 Spring Bean（Jar SDK 作为 Maven 依赖进 pom.xml） |
| `http` | `@FeignClient(name, url)` 接口 + `@GetMapping/@PostMapping` 方法（Feign），或 `RestClient` 封装 |

- **pom.xml 依赖注入**：`@service(bean = ..., jar = 'com.example:order-sdk:1.0')` → 自动加 Maven 依赖。
- **作用域**：`service` 短名全局唯一（同 app 级 structure/enum/logic 同级），`logic` 内 `userService` 为局部变量引用。
- **typecheck**：`service` 调用参数/返回类型校验（对齐本地逻辑方法调用的检查强度）。
- **确定性**：同一 service 声明 → 同一注入代码，可快照测试。

### 6.2 前端：第三方组件注册（对齐 NASL 扩展组件）

新增顶层概念 **`component`（组件注册声明）**——把 npm 第三方组件注册进 TDSL，
ViewElement 引用它并参与 `dataSource`/`props` 数据绑定：

```ts
// ---- 注册第三方组件（对齐 NASL components.lcapLogin 扩展组件）----
component ECharts {
  pkg: 'echarts-for-react';                 // npm 包名 → 生成 import
  defaultProps: { option: Json; style: Json };   // 声明式 props 契约
  events: ['onClick'];                      // 声明式事件
}

// ---- 页面里作为 ViewElement 使用，与其他元素同等参与绑定 ----
page OrderReport {
  <ECharts option={computeChartOption(orderStat)} dataSource={useQuery('orderStat')} />
}
```

**IR**：新增 `ComponentNode`（`pkg`、`defaultProps`、`events`），加入 `AppNode.components`。
`ViewElementNode.type` 引用 `ComponentNode`（内置组件与第三方组件统一为 `component` 目录）。

**codegen-react 映射**：
- `component ECharts { pkg: 'echarts-for-react' }` → `import ECharts from 'echarts-for-react';`
- ViewElement `<ECharts ...>` → `<ECharts {...props} />`，`props` 里的表达式（`option={...}`）照常生成。
- `events` → 事件回调绑定（`onClick={handleClick}`）。
- 内置组件（table/form/input/button）与第三方组件**同构**——`ViewElementNode` 不区分来源，
  只是 `type` 解析到内置目录还是 `components.*` 注册表。

### 6.3 为什么是主航道而不是逃生舱

| 维度 | 逃生舱（旧思路） | 主航道（本设计） |
|------|-----------------|-----------------|
| 写法 | 手写 Java/React 代码混进产物 | TDSL 声明 `service`/`component`，与业务同文 |
| 类型安全 | 无 | typecheck 校验签名/参数/返回 |
| 可生成 | 手改 | codegen 生成 `@DubboReference`/`@FeignClient`/`import` |
| 可测试 | 难 | 快照测试 + 与逻辑同链路验证 |
| LLM 可写 | 难（要懂框架细节） | 声明式，LLM 本能 |

关键点：**TDSL 只描述"我要调什么"（签名 + 配置），不描述"怎么调"（注入/装配细节归 codegen）**——
这才是让第三方能力进主航道的根本。

### 6.4 命名空间与外部能力的关系

- `service` / `component` 声明在 **app 全局作用域**（与 structure/enum/logic 同级）。
- logic 内 `userService` / `erpApi` 是**局部变量**（声明引用 → codegen 注入），与实体变量同规则。
- 与 §7（命名空间）正交：service 短名全局唯一；DS 作用域只管 entity。

---

## 7. 命名空间/作用域设计（专项）

> 这是用户最关心的缺口，单独成节。当前 `linkApp` 全局唯一 → 必须改为分层作用域。

### 7.1 作用域层次

```
app 全局（顶层）    : structure / enum / logic / interface（短名唯一）
数据源作用域        : entity（`dsName.entityName` 限定，跨源同名允许）
logic 方法体作用域  : 局部变量（`:=` 声明）、param、ForEach item
```

### 7.2 解析规则（优先序）

1. **局部作用域**：变量/param/ForEach item（logic 内）。
2. **数据源作用域**：当前数据源的实体短名。
3. **app 全局**：结构/枚举/逻辑/接口短名。
4. **限定名**：`dsName.entityName`（跨数据源显式引用）。

### 7.3 冲突规则

| 冲突 | 处理 |
|------|------|
| 同作用域重名（同数据源两实体同名） | **报错**（禁止歧义） |
| 不同数据源同名实体 | **允许**（作用域隔离），跨源用限定名 |
| 局部变量遮蔽数据源实体/全局 | **允许**（局部优先），遮蔽合法 |

### 7.4 影响面

| 层 | 改动 |
|----|------|
| core | `SymbolTable` 分层（`resolve` 支持作用域链 + 限定名） |
| parser | `linkApp` 重构；限定名语法 `ds.Entity` |
| typecheck | `resolveEntity` 感知作用域；遮蔽检查 |
| codegen-java | `entityNameOfIdent`/`findEntityByName` 感知数据源上下文 |
| codegen-react | 类型引用同样作用域解析 |

---

## 8. 能力边界评估：TDSL 能否满足"任意"需求？

### 8.1 诚实结论

**不能覆盖"任意"需求**——但这是所有低代码平台的共性，NASL 也一样。
NASL 覆盖了应用开发的**主航道**（数据/逻辑/页面/流程/权限），复杂定制靠
`JSBlock`/`JavaLogic`/扩展模块逃生。TDSL 必须明确自己的**覆盖边界 + 逃生舱**。

### 8.2 覆盖域（TDSL 规划要覆盖的）

| 需求类型 | 覆盖 | 说明 |
|----------|------|------|
| 标准 CRUD 业务系统 | ✅ | 表单/列表/详情/主子表/级联 |
| 复杂业务逻辑 | ✅ | 循环/分支/事务/Decimal/where 查询 |
| 多表关联查询 | 🟡 | 需补查询语言（§4.2） |
| 多页面应用 | 🟡 | 需 View 声明层 + 路由（§5） |
| 通用后端服务 | ✅ | Spring Boot + JPA + REST |
| **调用第三方后端能力** | 🟡 | **主航道**：`service` 声明 Dubbo/Bean/HTTP → 自动注入（§6.1） |
| **引入第三方前端组件** | 🟡 | **主航道**：`component` 注册 npm 包 → ViewElement 引用（§6.2） |
| 权限/流程/审批 | 🟡 | P2 按需裁剪 |

### 8.3 边界外（需逃生舱）

| 需求 | 现状 | 逃生方案 |
|------|------|---------|
| 复杂前端交互（拖拽画布/复杂动画/原生 WebGL） | ❌ | 自定义组件扩展点（`component` 注册 + 手写 React 包装） |
| 性能敏感 SQL / 复杂报表 | ❌ | 原生 SQL/Java 方法逃生（`@Query` 手写 / JavaLogic 等价物） |
| 私有协议/非标准中间件（需要专用客户端且无通用签名） | ❌ | 手写适配器 Bean 后，用 `@service(kind='bean')` 进主航道 |
| 高并发/特殊中间件 | ❌ | 生成工程可手改 + CI/CD 常规生态 |

### 8.4 设计原则（防"不能"变"灾难"）

1. **声明优先 + 逃生舱兜底**：90% 标准需求走声明式，10% 复杂需求给代码出口。
2. **生成工程可手改**：产物是完整工程（不是黑盒），手改后手动维护。
3. **LLM 补强**：`llm` 包让大模型把"边界外需求"翻译成逃生代码或调整 DSL。

---

## 9. 分阶段路线图

### 路线图总览

```
P1（语义可信 + 查询 + 前端真生成 + 外部能力）   P2（LLM + 工程化 + 裁剪域）        P3（平台化）
├─ M1 命名空间/作用域  ──────────►              ├─ llm prompt pack                 ├─ 编译服务常驻
├─ M2 查询语言(where复合/排序/分页)              ├─ cli / playground               ├─ CI/CD 流水线对接
├─ M3 逻辑补全 + 类型检查加深                    ├─ 流程/审批/权限(裁剪)            └─ 多应用/多租户
├─ M4 View 声明层 + 路由  ──────────►           ├─ 组件库抽象 + 校验
├─ M5 主子表/级联/软删/乐观锁                    └─ 组件市场/服务市场（可选）
└─ M6 外部能力接入(service/component)  ──►
```

### M1 — 命名空间/作用域（P1，先行）
- core：分层 `SymbolTable` + `resolve` 作用域链 + 限定名。
- parser：`linkApp` 重构；`ds.Entity` 限定名语法。
- typecheck/codegen：作用域感知的实体解析。
- **验收**：两个数据源各有同名实体（如 `erp.Order` / `crm.Order`）可共存、跨源限定引用。

### M2 — 查询语言（P1）
- `where` 复合条件（`and/or/like/in`）、`.orderBy`、`.page`、聚合 `sum/avg/max/min/count`。
- codegen-java：Repository 生成器升级（派生查询 + `@Query` JPQL）。
- **验收**：`curl` 验证复合查询/排序/分页/聚合。

### M3 — 逻辑语言补全 + 类型检查加深（P1）
- `While/Break/Continue/Unary/Index`、字符串方法、`Map`。
- 落实 `docs/dev/11`：类型推导/子类型/隐式转换/泛型统一。
- **验收**：typecheck 单测覆盖上述；错误诊断带 nodePath/行列。

### M4 — View 声明层 + 路由（P1，前端真生成）
- `page` 语法 + `ViewNode` IR + codegen-react 组件生成（替换固定模板）。
- 多页面路由 + 数据绑定 `useQuery/useMutation`。
- **验收**：TDSL 声明页面 → 生成完整 React 应用（不再是固定模板）。

### M5 — 数据完整性（P1）
- 级联删除/软删除/乐观锁/审计字段。
- **验收**：主子表级联 + 软删查询过滤。

### M6 — 外部能力接入（P1 主航道）
- 后端 `service` 声明（dubbo/bean/http）→ `@DubboReference`/`@Autowired`/`@FeignClient` 注入 + pom 依赖。
- 前端 `component` 注册（npm 包）→ ViewElement 引用 + import + props/事件绑定。
- **验收**：TDSL 声明一个 Dubbo 服务 + 一个本地 SDK Bean + 一个 ECharts 组件，
  双端 build 通过、注入代码正确、页面能渲染第三方组件。

### P2 — LLM 集成 + 工程化 + 裁剪域
- `llm` prompt pack、`cli`、`playground`；流程/审批/权限按业务裁剪；组件库抽象；
  `service`/`component` 市场（可选，复用声明即能力）。

### P3 — 平台化
- 编译服务常驻（对齐系统设计 §8）、CI/CD 对接、多应用/多租户。

---

## 10. 立即行动建议（下一步做什么）

按依赖顺序，**下一个切片建议是 M1（命名空间/作用域）**，理由：
1. 它是当前 `linkApp` 的设计缺陷（全局唯一限制表达力），且影响后续所有引用解析。
2. M2 查询语言、M4 View 声明层、M6 外部能力都依赖"引用能限定到数据源/实体/service"。
3. 改动面可控（core/parser/typecheck/codegen 联动，但都是解析层）。

M1 之后建议顺序：**M4（View 声明层）→ M6（外部能力）→ M2（查询语言）**——
M4 是"前端真生成"（用户最关心的非固定模板诉求延续）；M6 外部能力接入紧接其后，
让"主航道可扩展"（调用 Dubbo/SDK/HTTP + 引入第三方组件）尽早闭环。

---

## QA 记录（本规划）

| 序号 | 问题 | 结论 | 状态 |
|------|------|------|------|
| 1 | 短名全局唯一要不要改？ | **要**——改为数据源级作用域 + 分层符号表，跨源同名允许，限定名 `ds.Entity` 显式引用 | 已决策（M1） |
| 2 | 前端"真生成"靠什么？ | **View 声明层**（page/ViewNode/Binding），替换固定模板 | 已决策（M4） |
| 3 | 查询能力够不够？ | 不够——补 where 复合/排序/分页/聚合（对齐 NASL Query* 家族） | 已决策（M2） |
| 4 | 能不能满足"任意"需求？ | 不能，但无需——覆盖主航道 + 逃生舱（自定义组件/原生SQL/手改产物），对齐 NASL 定位 | 已决策 |
| 5 | 流程/审批/权限/UI组件库 | NASL 有但**按业务裁剪**，P2 再说 | 已决策 |
| 6 | 调用第三方后端能力（Jar SDK/Dubbo/HTTP）？ | **主航道一等公民**——`service` 声明（dubbo/bean/http），codegen 生成 `@DubboReference`/`@Autowired`/`@FeignClient` + pom 依赖，logic 里像本地方法调用 | 已决策（M6） |
| 7 | 引入第三方前端组件？ | **主航道一等公民**——`component` 注册 npm 包，ViewElement 引用并参与数据绑定/事件，与内置组件同构 | 已决策（M6） |
| 8 | 外部能力与命名空间的关系？ | service/component 在 app 全局作用域（短名唯一），logic 内调用是局部变量注入，与 §7 命名空间正交 | 已决策 |