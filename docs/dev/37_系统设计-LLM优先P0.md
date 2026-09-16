# 37 系统设计 - LLM 优先 P0（诊断结构化 / 表达式类型核对 / 修复出牌）

> <rv-add>2026-09-15 新建（承接 dev/36 需求 Gate 通过）。原则：全量齐报、分层有序；宽松放行保留兜底；出牌只在 llm 层。</rv-add>

## 1. 模块架构（改动面）

```
core/types.ts          Diagnostic 增加 code / suggestion / root 三字段（可选，向后兼容）
typecheck/index.ts     ① emit() 统一出口（stamps code/rank/root）→ 输出前定序
                       ② exprType() 表达式类型判定 + VarScope 作用域表（F4）
                       ③ 五核对点接线（F3），全部走 emit
llm/repair.ts          出牌：layer 分级挑牌 + diff 摘要 + 截断（F5）
```

不动的：parser、codegen-*、cli、playground。

## 2. 诊断结构化（F1/F2）

### 2.1 类型扩展（core/types.ts）

```ts
export interface Diagnostic {
  // 原有字段不动
  code: string;        // 错误码（新增，全量收口必填）
  suggestion?: string; // 结构化修复指引（可选）
  root?: string;       // 级联分组键（根因诊断自身为 undefined）
}
```

### 2.2 错误码表（typecheck/const）

分层（供排序与出牌共用的**同一张层表**）：

| layer | code | 现有诊断归类 |
|-------|------|--------------|
| 0 SYNTAX | `SYNTAX-*` | parse 阶段（repair 直收，不入本表） |
| 1 TYPE | `DANGLE-REF`、`ASSIGN-TYPE`、`CALL-ARITY`、`MEMBER-UNKNOWN`、`RETURN-TYPE` | 悬空引用 + F3 新增 |
| 2 API | `ENTITY-CALL`、`FFI-CALL`、`VIEW-COMPONENT`、`VIEW-BINDING`、`INTERFACE-LOGICREF`、`FOREACH-CONTAINER` | API 面存在性 |
| 3 DEP | `DEP-1..4`、`SERVICE-KIND`、`FORM-SEMANTICS`、`NULLABLE-HINT` | 声明一致性（含 warning） |

### 2.3 emit() 与定序

- 所有 `diagnostics.push(...)` 收敛为 `emit({code, severity, path, message, suggestion?, root?, source})` helper
- check() 末尾**一次稳定排序**：`severityRank → layerRank → 声明序`（pass 顺序即声明序）——根因（layer 低）稳定在前，确定性输出
- 级联归属：F3 检查遇到"上游已有 root 诊断（如 DANGLE-REF）的同一表达式"时不再重复报，标 `root: <上游code>#<path>`；已有 pass 保持不改（历史层积不动，只在 F3 侧生效），避免给既有单测带来断言漂移

## 3. 表达式类型核对（F3/F4）

### 3.1 变量作用域（F4）

`typecheck/src/scope.ts` 新建：`VarScope = Map<name, { type: TypeRef | null; source: 'param'|'decl'|'forof'|'unknown' }>`。

收集规则（单 pass 遍历 logics，顺语句序）：

- 复用现有 `forEachStatement` 骨架（避免第三遍遍历）——在检查同一语句时先 contribute 再 check
- VarDecl：类型 = 声明 `:T`（无则 `typeOf(init)`，双向兜底）
- ForEach：elem = 容器展开 `List<T>` / `Page<T>` 的 T（静态可得时）否则 unknown → **unknown 放行**（宽松兜底）

### 3.2 exprType()：TypeRef | null（null = 判定不出 → 放行）

| Expr.kind | 判定 |
|-----------|------|
| Ident | scope 查表；未知名 → null（sample 阶段介入过宽） |
| Numeric/String/Bool | primitive Integer·Decimal / String / Boolean |
| Member | obj 类型可解析（structure/entity）→ 属性 TypeRef；否则 null |
| Call(callee=Ident→logic nodePath) | logic 返回 TypeRef |
| Call(查询链) | entityQueryOf 已有：X.all/X.where→`List<X>`；.limit/.orderBy 保持；.page→`Page<T>`；.aggregate→数值（sum→Decimal） |
| Call(FFI) | catalog 返回 alias→primitive |
| New / NewList | 类型即所建 |
| Binary | 比较/`&&`/`||`→Boolean；`+ - * /`→两侧数值型宽化（Integer+Decimal→Decimal）|
| String/Numeric 字面拼接 | 同上 |

### 3.3 五核对点（全部 severity=error，code 见 2.2）

| 核对点 | 触发条件 |
|--------|---------|
| ASSIGN-TYPE | Assign 两侧均判定非 null 且不兼容（名义等价 reference；primitive 同型；Integer→Decimal 单向允许；Object 通配放行）|
| CALL-ARITY | 实参个数 ≠ 形参（logic 调用）|
| 参数类型 | CALL-ARITY 诊断附 message（不单列 code）|
| MEMBER-UNKNOWN | obj 判定为 structure/entity 而字段不存在 |
| RETURN-TYPE | logic 声明返回 vs `typeOf(return.value)` 不兼容 |
| NULLABLE-HINT | 成员链基座由 may-null 源（`Order.get` 等）赋值——severity **warning**（宽松放行的提示，不阻断）|

排除规则：容器元素 unknown / ds.Entity 形态歧义 / query 链成员访问留 codegen —— 一律放行，不给 F3 制造误报。

## 4. 修复出牌（F5，llm/repair.ts）

1. 分级挑牌：`layerRank` 最小的 code 集中一轮；同轮多条同类可给（对应"全量有序里取首层"），feedCount 上限 N=3 条
2. diff 摘要：记录上轮 top-layer，新 feedback 首行 `问题 5→2 个（当前层: TYPE）`
3. 截断：feedback 超 4000 字符按行截（保首层）
4. `validateTdsl` 输出形态不变（多 diagnostics 数组），只改 feedback 字符串构造

## 5. 测试策略（阶段五预置）

- 单测：destructuring 新字段断言（Diagnostic 含 code）＋每核对点 3 例（命中/放行/误报防线）——放行例必须过（核心红线：不破坏 272 存量）
- 回归：`npm test` + `slice/slice:multi/check-spec` 全绿；dev/31 基线重跑对比首轮可编译率/修复轮数
