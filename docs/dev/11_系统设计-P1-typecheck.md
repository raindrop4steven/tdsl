# 11 系统设计：P1 切面一 —— 完整 typecheck（类型检查器）

> 关联：`docs/10_设计/设计总览.md` §6（typecheck 目标定义）、`70_教程/03_typecheck.md`（P0 现状）
> 状态：**阶段二（系统设计）** — 待用户 Gate 确认
> 范围决策（2026-09-08）：**JSON AST 序列化 / zod 校验不做**（不需要编辑器界面），
> 语义核 Typed AST 即事实来源，保留未来扩展能力。

---

## 1. 目标（P1 达成什么）

把 typecheck 从 P0 的"最小检查"升级为**完整类型检查器**，达到详细设计 §6 的定位：
**编译期"语义可信"，保证生成的 React/Java 代码语义正确。**

### 1.1 P0 现状（基线）

现有 `packages/typecheck/src/index.ts`（154 行）只有两项检查：

| 检查 | 状态 |
|------|------|
| 悬空引用（所有 TypeRef reference 必须 resolve） | ✅ 有 |
| ForEach 容器必须是 `X.all`（X 为已声明实体） | ✅ 有 |
| 类型推导（infer） | ❌ 无 |
| 子类型/赋值兼容（assignable） | ❌ 无 |
| 隐式转换（Integer→Decimal 单向） | ❌ 无 |
| 泛型 List\<T\> 参数化/统一（unify） | ❌ 无 |
| 局部作用域符号表（变量/参数/循环项） | ❌ 无 |
| 诊断带行列（line/col） | ❌ 无（字段有但没填） |

### 1.2 P1 目标清单

按 `10_设计/设计总览.md` §7/§9 的目标定位补齐（四阶段：bind/infer/check/report）：

1. **bind（符号绑定）**：构建 SymbolTable（nodePath → 节点）；`resolve` 查表；成员访问沿类型结构下钻。
2. **infer（类型推导）**：为每个表达式推导类型（局部推导）。
3. **check（类型检查）**：`assignable(from, to)` 校验赋值/传参/返回；泛型实例化检查。
4. **report（诊断）**：Diagnostic 带 nodePath + line/col。

### 1.3 交付验收（可观察结果）

- [ ] typecheck 包新增 infer/assignable/unify 模块，`check(app)` 返回完整诊断。
- [ ] demo `todo.tdsl` 扩展后（含隐式转换、泛型、作用域用例）typecheck 通过。
- [ ] **负向用例**（故意写错的 DSL）逐一产生**正确的诊断信息**（message + nodePath + line/col）。
- [ ] 单测覆盖每条检查规则（正/负用例各一）。
- [ ] `npm run slice` 全链路仍通过（不回归 P0 闭环）。

---

## 2. 类型检查的阶段设计（四阶段管线）

```
AppNode
   │
   ▼
① bind      构建 SymbolTable：全局类型表 + 每个 Logic 的局部作用域链
   │        悬空引用诊断（保留 P0 行为）
   ▼
② infer     自底向上推导每个 Expr 的类型；语句级作用域登记（VarDecl/ForEach/Param）
   │
   ▼
③ check     逐语句校验：Assign/传参/返回值 assignable；条件必须是 Boolean；
   │        泛型 New/方法调用的参数化匹配；ForEach item 类型 = 容器元素类型
   ▼
④ report    输出 Diagnostic[] { path, line?, col?, message, severity }
```

四阶段不严格分轮——实现为**单次遍历 + 按需回查 SymbolTable**（编译器常规做法：
bind 先建表，infer/check 在同一次 AST 遍历中完成），保证 O(n) 且逻辑清晰。

---

## 3. 符号表与作用域设计

### 3.1 全局符号表（GlobalScope）

复用现有 `resolve(app, path)`（core/path.ts），不重复造表。全局可引用的符号：

| 短名/形态 | 指向 | 说明 |
|-----------|------|------|
| `Todo` | `app.datasources.defaultDS.entities.Todo` | 实体（link 阶段已绑定 nodePath） |
| `Todo.all` | 实体静态成员 | 类型 `List<Todo>` |
| `Todo.count` | 实体静态成员 | 类型 `Integer`（P1 内置实体静态方法） |
| `Priority.LOW` | 枚举成员 | 类型 `Priority` |
| 内置函数 | `nasl.util` 对齐的内置方法 | 见 §5 方法表 |

### 3.2 局部作用域（LocalScope，链式）

每个 Logic 一个作用域链，**块级作用域**（`If`/`ForEach` body 各自子作用域）：

```
LogicScope
 ├─ params: Map<name, TypeRef>          // 入参
 └─ block: BlockScope                   // 顶层 body
      ├─ vars: Map<name, TypeRef>       // VarDecl 声明
      ├─ parent: LogicScope             // 外层可见
      └─ ForEach → BlockScope(item)     // 循环项
```

- `VarDecl { name, init }` → 在当前块登记 `name: infer(init)`（无 init 时必须有显式 type，否则诊断）。
- `ForEach { item, container }` → 子作用域登记 `item: 元素类型`（`List<T>` 的 T；容器不是 List 则诊断）。
- 重名声明 → 诊断"变量重复声明"。
- 引用未声明 Ident → 诊断"未定义变量"（**注意**：与实体短名区分——查找顺序：局部 → 全局）。

---

## 4. 类型推导规则（infer）

对 `Expr` 判别联合逐一推导（`infer(expr, scope): TypeRef`）：

| Expr.kind | 推导规则 |
|-----------|---------|
| `Bool` | `Boolean` |
| `Numeric` | `Integer` |
| `String` | `String` |
| `Null` | `Null`（特殊类型，可赋给任意引用类型） |
| `Ident` | 局部作用域查 → 全局符号表查 → 都没有：诊断"未定义" |
| `Member` | 沿类型下钻，见 §4.1 |
| `Call` | 方法签名解析，见 §4.2 |
| `New` | `type` 即类型（校验构造参数与实体/结构字段匹配，P1 从宽：只查数量与字段名） |
| `NewList` | `List<elem>` |
| `Binary` | 见 §4.3 运算符规则 |
| `Group` | 透传内部类型 |

### 4.1 Member 下钻规则

`obj: TypeRef` × `prop: string` → 结果类型：

1. **obj 是实体** → 查实体属性：`todo.done` → `Boolean`；未找到 → 诊断"实体 X 无属性 Y"。
2. **obj 是结构** → 查结构属性：`input.title` → `String`。
3. **obj 是枚举** → 枚举成员：`Priority.LOW` → 枚举类型自身。
4. **obj 是 List\<T\>** → `.length` 内置属性（P1 暂不，先不处理，诊断"List 无属性"）。
5. **obj 是 primitive** → 诊断"基本类型无属性"。
6. **`X.all`** → 实体静态成员，`Member(Ident('X'), 'all')` 特判为 `List<X>`。

### 4.2 Call 方法解析

`callee: Member(obj, method)` 场景（`x.m(args)` 形态）：

| 方法 | 接收者类型 | 返回 | 参数校验 |
|------|-----------|------|---------|
| `.add(item)` | `List<T>` | `void`（CallStmt 用） | item assignable to T |
| `.get(i)` | `List<T>` | `T` | i: Integer |
| `.size()` | `List<T>` | `Integer` | 无参 |
| 实体静态 `X.all` | — | — | 不可调用（诊断） |
| 未知方法 | 任意 | — | 诊断"类型 X 无方法 Y" |

`Call(callee=Ident)` 形态（直接调用 logic，如 `calc(x)`）：查全局 Logic 签名，校验参数数量与类型。
（P1 范围：Logic 互调支持；`new` 构造校验从宽。）

### 4.3 Binary 运算符规则

| 运算符 | 操作数要求 | 结果类型 | 隐式转换 |
|--------|-----------|---------|---------|
| `===` / `!==` | 两侧类型相等（或一方 Null） | `Boolean` | — |
| `&&` / `||` | 两侧均 `Boolean` | `Boolean` | — |
| `+` | 均数值（Integer/Decimal）或均 String | String/Integer/Decimal | Integer→Decimal |
| `<` / `<=` | 均数值 | `Boolean` | Integer→Decimal |
| `*` `/` `%` `-` `>` `>=` | — | — | **P1 parser/AST 无此节点，不涉及** |

> 说明：当前 Expr 的 Binary operator 联合只有 `===/!==/&&/||/+/</<=`，与 P0 parser 一致。
> 扩展运算符（`-`/`*`/`/`/`>`/`>=`）属"完整表达式语言"切面，**不在本切面**（见 §8 切面边界）。

---

## 5. 隐式转换与子类型（assignable）

`assignable(from: TypeRef, to: TypeRef): boolean`：

1. **同型同值**：primitive 同名 → true。
2. **隐式数值提升**：`Integer → Decimal`（单向）→ true。
3. **Null 底型**：`Null → 任意引用类型`（实体/结构/枚举）→ true；`Null → primitive` → false。
4. **引用同源**：reference.path 相等 → true。
5. **泛型协变**：`List<S> → List<T>` 当且仅当 `assignable(S, T)`（P1 不变型近似：要求 S===T 或 S 可赋给 T）。
6. **其余** → false。

### 5.1 使用点

- `Assign { target, value }`：`assignable(infer(value), infer(target))`。
- `VarDecl { type?, init }`：有显式 type 时校验 `assignable(infer(init), type)`。
- `Call` 传参：实参 assignable to 形参。
- `Return`：`assignable(infer(value), Logic.returns[0].type)`（P0/P1 单返回值）。
- `If` 条件：`infer(cond)` assignable to `Boolean`。
- `ForEach` 容器：必须是 `List<T>`（泛型统一，见 §6）。

---

## 6. 泛型统一（unify）

P1 只处理 `List<T>`（Map/Page 在 P1 不引入书写语法，parser 已支持但 demo 不用）：

- `ForEach(item in container)`：`infer(container)` 必须为 `List<T>`，item 类型绑定为 `T`。
- `x.add(y)`：y 可赋给 `List` 的元素类型 T。
- `new List<Todo>()`：NewList 的 elem 即 T，列表操作按 T 校验。
- 泛型参数中出现悬空引用：在 bind 阶段报（泛型 args 递归检查，已有逻辑保留）。

---

## 7. 诊断格式（Diagnostic）

沿用现有 `Diagnostic { path, line?, col?, message, severity }`，P1 补齐：

1. **line/col 填充**：typecheck 无法从 AST 拿行列（AST 节点无位置信息——P0 取舍）。
   **方案**：parser 在 link 阶段把"每个 Logic 的 body 首行"记录到 LogicNode（新增 `loc?: { line, col }`），
   typecheck 诊断退化为**Logic 级定位**（不精确到表达式），path 仍精确到节点。
   > 精确到表达式的行列需要 AST 节点全量带位置——成本高，P2 做 LLM 修复闭环时再评估。
2. **message 规范**：中文，包含：错误类别 + 期望/实际类型 + 符号名。
   例：`类型不兼容: 期望 List<Todo>，实际 Integer`。
3. **severity**：P1 全部为 `error`（warning 规则暂无）。

---

## 8. 切面边界（本切面做什么/不做什么）

| 项 | 本切面 | 说明 |
|----|--------|------|
| infer / assignable / unify / 局部作用域 | ✅ 做 | 核心交付 |
| 悬空引用 + ForEach `.all` 检查 | ✅ 保留 | P0 行为不回归 |
| 诊断带 Logic 级 line/col | ✅ 做 | parser 侧配合记录 LogicNode.loc |
| 表达式运算符扩展（`-`/`*`/`/`/`>`/`>=`/`!`/`-` 一元） | ❌ 不做 | 属"完整表达式语言"切面（P1 后续切面） |
| while/break/continue/Index/Unary 节点 | ❌ 不做 | 同上，core/parser/typecheck/codegen 四包联动，独立切面 |
| Map/Page 泛型的书写与检查 | ❌ 不做 | parser 已支持解析，检查器按 List 规则处理即可 |
| JSON AST 序列化 / zod | ❌ 不做 | 范围决策：不需要编辑器界面，保留扩展能力 |
| 接口 Endpoint / View 页面 | ❌ 不做 | P1 后续切面 |

---

## 9. 测试策略（TDD）

单测文件：`packages/typecheck/test/*.test.ts`（vitest）。

**规则矩阵**（每条规则正/负用例）：

| 规则 | 正例 | 负例（期望的诊断） |
|------|------|------------------|
| 未定义变量 | 已声明后使用 | `x := 1; y := x + z;` → "未定义变量 z" |
| 重复声明 | — | `x := 1; x := 2;` → "重复声明" |
| Member 下钻 | `todo.done` | `todo.does` → "实体 Todo 无属性 does" |
| primitive 无属性 | — | `n := 1; n.foo` → "基本类型无属性" |
| add 参数 | `list.add(todo)` | `list.add(1)` → "类型不兼容" |
| 二元 === | `a === b`（同型） | `1 === 'x'` → "比较类型不一致" |
| && 操作数 | `a && b`（均 Boolean） | `1 && x` → "&& 需要 Boolean" |
| `+` 数值 | `1 + 2` | `1 + 'x'` → "+ 需要数值或字符串两侧一致" |
| 隐式提升 | Integer→Decimal | Decimal→Integer（反向）→ "类型不兼容" |
| Null 赋引用 | `t := null`（t: Todo） | `n := null`（n: Integer）→ "类型不兼容" |
| ForEach 容器 | `for (t in Todo.all)` | `for (t in todo)` → "容器必须是 List" |
| 循环项类型 | 循环体内 `t.done` | 循环体内 `t.foo` → "无属性" |
| Return 兼容 | `return result`（List\<Todo\>） | `return 1` → "返回类型不兼容" |
| Logic 互调 | `calc(input)` | `calc(1)` → "参数类型不兼容" |

**集成**：demo `todo.tdsl` 扩展为含隐式转换/Logic 互调/作用域的用例，`npm run slice` 通过（正例）；
新增 `todo-bad.tdsl` 负例集，期望检查器给出全部预期诊断。

---

## 10. 里程碑（本切面内）

1. **M1 作用域+推断骨架**：LocalScope 链 + infer 骨架（字面量/Ident/Member 下钻）+ 未定义/重复声明诊断。
2. **M2 兼容性检查**：assignable + Assign/VarDecl/Return/If/ForEach 全语句校验 + 隐式提升。
3. **M3 方法与泛型**：Call 方法表 + List\<T\> 统一 + add/get/size。
4. **M4 诊断定位**：parser 记录 LogicNode.loc + 诊断填充 line/col + demo 扩展 + 全量单测。

每步 `npm test`（单测）+ 末期 `npm run slice`（闭环不回归）。

---

## QA 记录（本切面）

| 序号 | 问题描述 | 结论 | 状态 |
|------|---------|------|------|
| 1 | 诊断行列怎么定位？AST 节点无位置信息 | Logic 级定位：parser 在 link 时记录 LogicNode.loc，诊断退化到 Logic 级；表达式级定位 P2 评估 | 已决策 |
| 2 | Numeric 字面量推导为 Integer 还是 Decimal？ | Integer；需要 Decimal 时显式声明 VarDecl type 或用 Decimal(10,2) 语法 | 已决策 |
| 3 | `+` 是否支持 String 拼接？ | 支持（两侧均 String 时结果 String；数值提升 Integer→Decimal） | 已决策 |
| 4 | Map/Page 泛型检查？ | parser 可解析；检查器 P1 只保证 List\<T\> 语义，Map/Page 按"仅声明不操作"通过 | 已决策 |
| 5 | Logic 互调参数校验？ | 支持全局 Logic 短名直调，校验参数数量与 assignable | 已决策 |
