# 01 core：语义核 / Typed AST / FFI 目录

> 配套代码：`packages/core/src/`（types 222 行 / stdlib 203 行 / symbols 100 行 / path 79 行 / expr 37 行 / typeref 13 行 / statement 11 行 / id 24 行）
> 定位：**唯一事实来源（SSoT）**。所有下游（parser 产它、typecheck 验它、双端 codegen 吃它）都围绕这棵 Typed AST。

## 1. 节点全家福（types.ts）

`App` 是聚合根，十类域挂在其下：

```ts
interface AppNode {
  kind: 'App';
  name: string;
  datasources: DataSourceNode[];   // 实体（M1：实体短名归数据源作用域）
  structures: StructureNode[];     // DTO / 嵌套结构
  enums: EnumNode[];               // 枚举（G1：label 字段）
  logics: LogicNode[];             // 业务逻辑（P11 双语法同构）
  interfaces: InterfaceNode[];     // REST 契约 → Controller + 前端 fetch
  views: ViewNode[];               // M4：page/dialog 声明层
  services: ServiceNode[];         // M6：dubbo/bean/http 外部服务
  components: ComponentNode[];     // M6：npm 三方前端组件注册
  dependencies: DependencyNode[];  // dev/32：dependency java/npm 声明
}
```

几个值得注意的节点设计：

| 节点 | 关键字段 | 设计意图 |
|------|----------|----------|
| `EntityProperty` | `type: TypeRef` + `primary/nullable/unique` | 数据完整性标记直接进 AST |
| `ViewElement` | `type/props/bindings/children` | JSX 子集 → IR（不是真 JSX，props 表达式有限集合） |
| `Binding` | `name:'useQuery'\|'useMutation'\|'navigate'` | 从 props 表达式提取，前端 hooks 生成的依据 |
| `Service` | `kind_:'dubbo'\|'http'` + `config` | 外部系统对接（dev/33 删 bean：本地 jar 走 dependency+libs 直调） |
| `Dependency`（dev/32/34） | `eco:'java'\|'npm'` + `name/version/ns` + `imports?`/`importDefault?` | `dependency java "g:a:v" as ns import { JSON as J };` → 声明式依赖；import 可选（缺省 = 产物全量兼容） |

## 2. 类型与表达式（typeref / expr / statement）

- `TypeRef` 四形态：`primitive`（String/Integer/Decimal/Boolean/Date/DateTime/Time）/ `reference`（nodePath）/ `generic`（List|Map|Page）/ `db`。
- `Expr` 小表达式语言：字面量、Ident、Member、Call、Binary（含 M2 的 `like`/`in`）、New/NewList、Group。**没有**赋值/自增——语句面才有的东西不进表达式。
- `Statement`：VarDecl(`:=`/`const`)、Assign、If、ForEach、Return、CallStmt、Throw（dev/30 A1）。

## 3. 符号表与寻址（symbols.ts / path.ts）

**M1 分层符号表**（`buildTypeSymbolTable`）：

- `global`：结构/枚举/逻辑/接口 + **全局唯一**的实体短名 → nodePath
- `dataSources`：`dsName → Map<实体短名, nodePath>`（实体短名归数据源作用域）
- `resolveShort(table, name, ctxDs)`：先查当前数据源，再回退全局；`isAmbiguousEntity` 报歧义
- `resolveQualified(table, dsName, entName)`：限定名 `ds.Entity`
- `VarScope`：function 内变量块作用域，**Java 复用语义**（同块同名复用、无遮蔽）

**寻址**（`path.ts`）：引用一律存 nodePath 字符串，`resolve(app, path)` 编译期绑定；悬空返回 null → typecheck 报诊断。`nodePathOf` 反向：从节点拿路径（诊断 `path` 字段的来源）。

## 4. FFI 目录（stdlib.ts，dev/27 + dev/32）

Java 一等公民的机制核心，分两层：

**内核五域**（`FFI_CORE`，语言自有，属于类型定义的一部分）：

| 别名 | Java 类 | 端 |
|------|---------|-----|
| `String` | `java.lang.String` | 双端（js 模板翻译如 `contains` → `includes`） |
| `Decimal` | `java.math.BigDecimal` | backend-only |
| `Date` / `DateTime` | `java.time.LocalDate/LocalDateTime` | backend-only |
| `List` | `java.util.List` | 双端（前端数组原生映射） |

每个成员是 `FfiMethod{ name, static?, params, ret, java?, js? }`——**有 java 才能后端调、有 js 才能前端调**；模板缺省 = `{recv}.{name}({args})` 直发。

**第三方外置**（dev/32 边界）：一切带 Maven/npm 坐标的类**不进 core**，放工程 `libs/*.json` 扫描产物，经 `createCatalog(loaded, deps)` 合并：

```ts
const cat = createCatalog(libs, app.dependencies);
cat.byAlias('JSON')            // 裸名：唯一命中才返回（撞车 undefined + collisions 记录）
cat.byQualified('fj', 'JSON')  // dependency ... as fj 的限定命中
```

- 产物类自动补 `maven` 坐标（来自产物头 `coordinate`）
- **alias 全局唯一不变式**：撞车（fastjson vs jackson 都有 `JSON`）记入 `collisions`，诊断权在 typecheck（D-dep-4）
- `depMatches`：按 name 段匹配（版本通配），版本比对归 D-dep-3

## 5. 本包要记住的 3 件事

1. **core 是 SSoT**：改 `types.ts` 判别联合后，TS 编译会强制你补齐所有消费端的 `never` 收窄点——顺着报错改完即闭环。
2. **语言自有 vs 第三方的边界**：五域进 `FFI_CORE`，带坐标的一律外置 libs/（dev/32），core 不认识任何第三方 jar。
3. **引用即路径**：所有跨节点引用都是 nodePath 字符串 + `resolve()`，这让 AST 可序列化、可 diff、可被 LLM 按 path 定点修复。

**动手练习**：在 `packages/core/test/stdlib.test.ts` 基础上，构造两个同名 alias 的产物 + 一个 `as ns` 声明，验证 `byAlias` 返回 undefined、`byQualified` 命中、`collisions` 为空。
