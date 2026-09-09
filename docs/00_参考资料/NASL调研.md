# 参考资料：网易 CodeWave NASL 调研

> 调研对象：NASL（Natural App Specification Language），网易 CodeWave 智能低代码平台的核心语言。
> 来源：`https://nasl.codewave.163.com/docs/current/`（Docusaurus 文档站，版本 Latest 3.13）
> 抓取日期：2026-09-07
>
> ⚠️ 定位说明：本文档**仅供技术参考**。我们设计自研 DSL 时参考 NASL 覆盖的领域范围和设计思想，
> 但不照抄其器端面（前端/编辑器视角）的 JSON AST 结构。详见 `10_设计/设计总览`。

---

## 1. 是什么

NASL 是网易 CodeWave 平台为"低代码应用"定义的一套 **语义树（Semantic Tree）**，而不是传统脚本语言。
同一棵树有三种投影：

| 投影 | 形态 | 定位 |
|------|------|------|
| **JSON AST** | 树形 JSON，每个节点带 `concept` 字段 | 事实来源、存储、传输、可序列化 |
| **Textual NASL** | 人类可读文本（`@decorator (...) Type name;`） | 展示、diff、版本库友好 |
| **Natural TS** | 近似 TypeScript 的宿主语言投影 | 让用户获得现代 IDE 的类型提示体验 |

关键机制：
- 每个节点都有 **`concept`**（节点类型标签，如 `Structure`、`TypeAnnotation`、`Logic`、`View`）。
- 节点之间有 **继承关系**（如 `Annotatable` → `Entity/View/Logic`）和 **组合关系**（`App -> DataSource -> Entity -> EntityProperty -> TypeAnnotation`）。
- 通过 **nodePath / namespace** 做树内寻址（如 `app.datasources.defaultDS.entities.Student`）。
- 代码生成 = 遍历 Object Model（带增删改查行为的 AST 实例）输出目标语言（Vue + Java）。
- 树节点既是**数据**（JSON）也是**对象**（Object Model），类比 `HTML ↔ DOM`。

---

## 2. 三投影详解

### 2.1 JSON AST（示例：Structure）

```json
{
  "concept": "Structure",
  "name": "ProductOrder",
  "description": "表示商品订单的结构",
  "properties": [
    {
      "concept": "StructureProperty",
      "name": "product",
      "label": "商品",
      "typeAnnotation": {
        "concept": "TypeAnnotation",
        "typeKind": "reference",
        "typeNamespace": "app.dataSources.defaultDS.entities",
        "typeName": "Product",
        "ruleMap": {}
      }
    },
    {
      "concept": "StructureProperty",
      "name": "count",
      "label": "数量",
      "typeAnnotation": {
        "concept": "TypeAnnotation",
        "typeKind": "primitive",
        "typeNamespace": "nasl.core",
        "typeName": "Long",
        "ruleMap": {}
      }
    }
  ]
}
```

要点：每个节点都有 `concept`；类型用 `typeNamespace` + `typeName` 字符串表达；`ruleMap` 承载编辑器额外信息。

### 2.2 Textual NASL（同一 Structure）

```text
@(description = "表示商品订单的结构")
struct ProductOrder {
  @(label = "商品", description = "", jsonName = "")
  product: app::dataSources::defaultDS::entities::Product;
  @(label = "数量", description = "", jsonName = "")
  count: Integer;
}
```

### 2.3 Natural TS（宿主语言投影）

```ts
export class ProductOrder {
  product: Product;
  count: Integer;
}
```

---

## 3. 类型系统

NASL 是静态类型语言，所有值都有类型。

### 3.1 原子类型（PrimitiveTypes）

| NASL 类型 | 说明 | TypeScript 对齐 | Java 对齐 |
|-----------|------|----------------|-----------|
| `Boolean` | 布尔 | `boolean` | `boolean` |
| `Integer` | 整数（无长短区分，都是长整型） | `number` | `long` |
| `Decimal` | 精确小数（无 double） | `number` | `BigDecimal` |
| `String` | 字符串 | `string` | `String` |
| `Date` | 日期 | `string '2020-12-02'` | `LocalDate` |
| `Time` | 时间 | `string '10:30'` | `LocalTime` |
| `DateTime` | 日期时间 | `Date` | `ZonedDateTime` |

### 3.2 引用类型（ReferenceTypes）
- **数据结构 Structure**：`{ "concept": "Structure", ... }`
- **枚举 Enum**：`{ "concept": "Enum", "name": "Color", "enumItems": [...] }`

### 3.3 泛型类型（GenericTypes）
- 只能使用，不能自行定义，如 `List<T>`（对应 `java.util.List`）。

### 3.4 类型层级与隐式转换
- `Any`（java.lang.Object）是所有类型的超类型（顶级类型）。
- `Null` 是所有类型的子类型（底层类型），字面量 `null`。
- 隐式转换规则：
  1. 子类型赋值给超类型时隐式转换。
  2. 原子类型可沿 `Integer -> Decimal` 方向单向转换。
  3. 不支持用户自定义隐式转换策略。

---

## 4. 命名空间（Namespaces）

### 4.1 官方命名空间（集中在 `nasl.` 下）
- `nasl.core` 官方类型；`nasl.util` 内置函数；`nasl.collection` 集合；`nasl.interface` 官方接口
- `nasl.ui` 组件库（`.pc` `.h5` `.mp` 分端）；`nasl.browser` 浏览器 API
- `nasl.validation` 验证器；`nasl.process` 流程；`nasl.annotation` 装饰器
- `nasl.io` 文件；`nasl.path` 路径；`nasl.resource` 资源；`nasl.database` 数据库
- `nasl.event` 事件；`nasl.logging` 日志；`nasl.i18n` 国际化；`nasl.debug` 调试
- `nasl.test` 测试；`nasl.auth` 认证鉴权；`nasl.organization` 组织；`nasl.message` 消息
- `nasl.experimental` 试验；`nasl.math` 数学；`nasl.string` 字符串；`nasl.datetime` 日期时间
- `nasl.object` 对象；`nasl.system` 系统

示例：`nasl.core.Integer;` `nasl.collection.PageOf;` `nasl.util.Convert;` `nasl.util.consoleLog;`

### 4.2 用户命名空间（`app.{concept复数}.{name}...`）
所有概念前统一加 `{concept复数}` 段以解决重名：
- 顶层：`app.dataSources.defaultDS.entities.Student;` `app.views.Student;`
- 子页面/逻辑：`app.views.Student.views.create;` `app.views.Student.logics.create;`
- 多层子页面：`app.views.Student.views.list.views.detail.views.update;`
- 页面元素（类似 Vue $refs）：`app.views.Student.elements.table1;` `app.views.Student.logics.table1;`
- 自动生成逻辑：`app.dataSources.defaultDS.entities.Student.logics.create;`
- 流程：`app.processes.Student.logics.launch;`

### 4.3 扩展相关命名空间
- 扩展模块：`extensions.freemarker.structures.Student`
- 接口：`interfaces.nuims.interfaces.getUserInfo` / `interfaces.nuims.structures.UserResource`
- 扩展组件：`components.lcapLogin.structures.Student`

---

## 5. 节点寻址：nodePath 与 namespace

从《node-path-examples》文档提取的规则（`[Concept]` 表示抽象概念；`name` 表示该节点的命名属性）：

```
app.dataSources[name=dataSource1]                                    DataSource
app.dataSources[name=dataSource1].entities[name=entity1]             Entity
app.dataSources[name=dataSource1].entities[name=entity1]
      .properties[name=entityProperty1]                              EntityProperty
... .properties[name=entityProperty1].typeAnnotation                 TypeAnnotation
... .typeAnnotation.typeArguments[2]                                 TypeAnnotation
... .typeAnnotation.returnType[2]                                    TypeAnnotation
... .typeAnnotation.properties[name=structureProperty1]              StructureProperty
... .properties[name=structureProperty1].defaultValue                DefaultValue
... .defaultValue.expression                                        [[LogicItem]]（抽象）
... .defaultValue.expression.params[name=param1]                     Param
... .defaultValue.expression.returns[name=return1]                   Return
```

---

## 6. 语法树继承关系（概念级）

从《inheritance-diagram》提取的关键继承关系：
- `Annotatable`（可注解基类）→ `Entity` / `View` / `ViewElement` / `Logic`
- `Logic` → `PermissionForSharedScope` / `AuthLogic` / `AuthLogicForCallInterface` / `BusinessLogic`(等)
- `BaseSetter` → `InputSetter` / `SwitchSetter` / `EnumSelectSetter` / `NumberInputSetter` / `IconSetter` / `ImageSetter` ...
- `FrontendVariable`、`LogicItem`（逻辑项抽象）→ `SubLogic` / `AnonymousFunction`
- 表达式（继承自某 Expr 基类）：`Abort` `Start` `End` `IfStatement` `SwitchStatement` `SwitchCase`
  `ForEachStatement` `WhileStatement` `Break` `Continue` `Assignment` `BatchAssignment` `Comment`
  `CallLogic` `CallEvent` `CallFunction` `CallInterface` `CallMicroserviceInterface` `Destination`
  `ExternalDestination` `ValidationRule` `Argument` `Anchor` `JSBlock` `JavaLogic` `Block`
  `Identifier` `NullLiteral` `BooleanLiteral` `StringLiteral` `StringInterpolation` `NumericLiteral`
  `BinaryExpression` `MatchCase` `Match` `UnaryExpression` `MemberExpression` `Unparsed` `New`
  `NewComposite` `NewStructure` `NewList` `NewMap` `Paginate`
- 查询：`CallQueryComponent` `QuerySelectExpression` `QueryFromExpression` `QueryJoinExpression`
  `QueryFieldExpression` `QueryAggregateExpression` `QueryOrderByExpression` `QueryGroupByExpression`
  `QueryLimitExpression` `SqlQueryComponent` `OqlQueryComponent`
- 流程/审批：`MultiApprovalPolicy` `SequentialPolicy` `CountersignPolicy` `ProcessOutcome`
  `Assignee` `ProcessOutcomes`；`TriggerEvent` `MsgTriggerEvent` `InterfaceTriggerEvent`
  `ConnectorTriggerLauncher` `MsgTriggerLauncher`；`Connector` `CallConnector` `ConnectorLogic`
- 管理器/审批策略：`ManagerV2` `DirectManagerV2` `DepartmentManagerV2`；`Assignees`
  `UserAssignees` `RoleAssignees` `DepartmentAssignees`；`ApprovalPolicyV2`
  `SequentialPolicyV2` `CountersignPolicyV2` `OrSignPolicyV2` `UnmannedApprovalStrategyV2`
  `AutoApproveUnmannedV2` `AutoRejectUnmannedV2` `ReassignUnmannedV2`

---

## 7. 语法树组合关系（概念级）

从《composition-diagram》提取的关键组合结构（`A --> B` 表示 A 组合了 B）：
- `App` → `DataSource` `Structure` `Enum` `Logic` `View` `Process` ...
- `DataSource` → `Entity` `Configuration`；`Entity` → `EntityProperty` `EntityIndex`
  `PermissionForSharedScope`；`EntityProperty` → `TypeAnnotation` `DatabaseTypeAnnotation` `DefaultValue`
- `Structure` → `TypeParam` `StructureProperty`；`StructureProperty` → `TypeAnnotation` `DefaultValue`
- `Enum` → `EnumItem` `TypeAnnotation`；`EnumItem` → `StaticString`
- `Logic` → `Transactional` `TypeParam` `Param` `Return` `Variable` ...（业务方法结构）

---

## 8. NASL SDK

定位：针对 NASL 投射编辑的**无可视化软件工具包**，IDE 和前端生成服务主要以其为核心开发。
可运行于现代浏览器和 Node.js (>=14)。

主要功能：
- **NASL Object Model**：语法树节点结合增删改查等行为的实例化对象（类似 HTML↔DOM、CSS↔CSSOM）。
- **vertexsMap**：一个 app 下所有"点 id → Vertex"的映射集。
- 生成**中间代码或 Vue 等最终代码**的方法。
- 实体拖拽方法；请求、遍历树、去重名等工具库。

不带的功能：应用本身创建/删除、应用发布。

快速开始（示例，来自官方文档）：
```ts
import * as nasl from '@lcap/nasl';   // 示意
async function start() {
  const app = new nasl.App({ id: appId });
  nasl.config.defaultApp = app;
  await app.loadAll();
  const page0 = app.firstWebService.pages[0];
  await page0.rootView.load();
  console.log(page0.rootView.toVue());   // 生成 Vue 代码
}
```
官方示例仓库：`https://github.com/netease-lcap/nasl-examples`

---

## 9. 对我们的启发（结论）

值得参考：
1. **语义树 + 多投影**的思想（Textual / Natural TS / JSON 三视图）。
2. **领域覆盖面**：数据源、实体、结构、枚举、逻辑、接口、页面、流程、审批、权限。
3. **命名空间 / nodePath 寻址**解决跨节点引用的思路。
4. **Object Model**（节点带行为）的设计，类比 DOM。

我们不采用 / 需要重设计：
1. **JSON AST 作为事实来源** —— 它是前端/编辑器视角产物，`concept` 运行时字符串 + `ruleMap` 混入语义，编译器视角业余。我们改用**类型化 AST 作为语义核**，JSON 只是序列化视图。
2. **`typeNamespace`+`typeName` 字符串引用类型** —— 改名需全文改串；我们改**符号引用 + 编译期 resolve 绑定**。
3. **逻辑体为拖拽型场景脚本树** —— 我们改成一门有文法、可解析、可类型检查、可编译的小表达式/语句语言。

---

## 附：文档站导航目录（给我们梳理领域覆盖用）

```
overview/ intro（语言概览） inheritance-diagram（继承图） composition-diagram（组合图）
          node-path-examples（节点路径） namespaces（命名空间） types（类型）
ast/      intro
api/      intro（标准库 API）
playground/ json-to-textual（JSON AST ↔ 文本）
protocol/  extension  /  NANP协议v1.0
contribution/ process
sdk/      intro
```
