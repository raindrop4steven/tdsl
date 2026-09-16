# 38 详细设计（逻辑）- LLM 优先 P0

> <rv-add>2026-09-15 新建。承接 dev/37 系统设计，落到函数签名与接线点.Statement 域（core/statement.ts:5-12）：VarDecl{type?,init?}/Assign{target,value}/Return{value?}/If/ForEach{item,container,body}/CallStmt/Throw。</rv-add>

## 1. core/types.ts：Diagnostic 扩展

```ts
export interface Diagnostic {
  // 原字段不动（path/line?/col?/file?/message/severity）
  code: string;        // 必填；typecheck 与 llm 出牌共用同一层表
  suggestion?: string; // "改成什么"一句话
  root?: string;       // 级联归属键：`${根因code}#${根因path}`；根因自身不填
}
```

兼容性：字段追加且 typecheck 侧必填可行（Diagnostic 仅由 typecheck 构造，消费方只读；cli/llm/playground/server 均为只读消费，无构造点——grep 确认后此断言成立才动手）。

## 2. typecheck/index.ts：emit 与层表

```ts
export const DIAG_LAYERS = { SYNTAX: 0, TYPE: 1, API: 2, DEP: 3 } as const;

type EmitInput = {
  code: string;
  layer: keyof typeof DIAG_LAYERS;
  severity: 'error' | 'warning';
  path: string; message: string;
  suggestion?: string; root?: string;
};

function makeEmit(app: AppNode) {
  const diagnostics: Diagnostic[] = [];
  const emit = (i: EmitInput): void => { diagnostics.push({ ...i }); };
  return { emit, diagnostics };
}
```

check() 尾部定序（确定性、稳定）：

```ts
diagnostics.sort((a, b) => {
  const r = (d: Diagnostic) => (d.severity === 'error' ? 0 : 1);
  return r(a) - r(b) || layer(a.code) - layer(b.code) || 0; // layer 内声明序：sort 稳定保序
});
```

改造点清单（把现有 push 换 emit 并补 code/suggestion——逐处标注）：

| 现有 push 位置 | code | suggestion 例 |
|----------------|------|---------------|
| L140 悬空引用 | `DANGLE-REF` | `声明 ${path} 所指类型，或改为已声明类型` |
| L165 ForEach | `FOREACH-CONTAINER` | `容器应为实体查询/已声明列表变量` |
| L182 接口端点 | `INTERFACE-LOGICREF` | `补声明 function ${...} 或改正 logicRef` |
| L211 service kind | `SERVICE-KIND` | `@service(kind = 'dubbo')` |
| L218 http 操作 | `SERVICE-HTTP-OPER` | `操作声明 METHOD 'path'` |
| view/npm 相关 | `VIEW-COMPONENT` / `VIEW-BINDING` / `FORM-SEMANTICS` | 现文案拆 suggestion |
| checkDependencies | `DEP-1..DEP-4` | 现文案拆 suggestion |

## 3. typecheck/scope.ts：VarScope（F4）

```ts
export interface VarInfo { type: TypeRef | null; source: 'param' | 'decl' | 'forof' | 'unknown' }
export type VarScope = Map<string, VarInfo>;

export function scopeOfLogic(l: LogicNode): VarScope;           // params 入表
export function contribute(st: Statement, scope: VarScope): void; // VarDecl 落表（type ?? typeOf(init); 均 null → unknown）
export function contributeForOf(st: ForEach, app: AppNode, scope: VarScope): void; // 容器展开 T
```

- `contributeForOf`：`typeOf(container)` 为 `List<T>`/`Page<T>` generic → item:T；otherwise unknown（放行）
- 作用域用 Map **顺序收集、覆盖式更新**（重声明后值生效）——宽松策略下不做 shadow 报错

## 4. typecheck/expr-type.ts：exprType（F3 判定核）

```ts
export function exprType(app: AppNode, e: Expr, cat: EffectiveCatalog, scope: VarScope): TypeRef | null;
```

实现按 dev/37 §3.2 表格逐 kind：判不出 → `null`（调用方一律放行）。查询链类型：扩展 `entityQueryOf` 思路新增 `queryResultType(app, e)`（只识别 X.all/X.where 起点 + .orderBy/.limit/.groupBy 不改型 + .page→Page<T> + .aggregate→Decimal）。FFI：`ffiByAlias` 反查返回 primitive。

**兼容性统一（assignability）**：

```ts
export function assignable(a: TypeRef | null, b: TypeRef | null): boolean | null;
// a=左侧目标类型, b=右侧值类型; null 参与 → null(放行); true/false 才判定
```

规则：Object 通配放行；reference 名义（path 相等）；primitive 同型；`Integer → Decimal` 单向；`List/Page` 泛型递归同型；其余 false。

## 5. check() 内五核对点接线（复用现有遍历骨架，不新增遍历）

接线：在现有 `forEachStatement(l.body, ...)` 各 pass 内顺手调用（F2 限一次遍历增量）：

1. **Assign**（.assignable 判定）：`assignable(exprType(target), exprType(value)) === false` → ASSIGN-TYPE
2. **CallStmt/表达式 Call → logic**：`callee=Ident 且 app.logics 有同名` → 实参个数 ≠ 形参 → CALL-ARITY（attach 实参类型到 suggestion）；`callee=Member.prop` 实体方法/FFI 不在此核（已有 pass 覆盖）
3. **Member**：`exprType(e.obj)` 为 structure/entity reference 且 resolve 到节点后属性表无该 prop → MEMBER-UNKNOWN
4. **Return**：`ret.returns[0].type` 与 `exprType(ret.value)` assignable === false → RETURN-TYPE
5. **NULLABLE-HINT**：`mayNullSources`（`X.get(...)`/`query.first` 赋值目标入 scope 标 nullable）；Member 基座为 nullable 变量 → warning

全部核对点**先查 `diagnostics.some(根因在自己 path 上)` 再跳过**——保住"根因优先、连坐不重复"（root 字段在 F3 侧生效）。

## 6. llm/repair.ts：出牌（F5）

```ts
const LAYER_RANK = ['SYNTAX', 'TYPE', 'API', 'DEP'];

interface DiagOut extends Diagnostic { layer?: number }

// feedback 构造改为三段式：
// ① 摘要行：`问题 N→M 个（当前层: ${layerName}）`（首轮无上轮时 `问题 N 个`）
// ② 首层明细 ≤3 条：`[TYPE/ASSIGN-TYPE] 逻辑 X ｜ 赋值类型不匹配 ...（改成: ...）`
// ③ 尾注：`其余 N-3 条同类问题暂缓，修复后自动出示` ；全文 >4000 字符按行截断
```

- `humanizePath` 复用；`code` 面向 LLM 附中文层名（SYNTAX/类型/API/依赖）
- `validateTdsl` 返回结构不变；`repairLoop` 轮间携带 `prevCount` 做 diff（签名加可选项不打断现调用方）

## 7. 单测清单（阶段五执行基准）

| 文件 | 新增用例 |
|------|---------|
| core | Diagnostic 带 code/rank 字段快照 |
| typecheck/expr-type | 五核对点 ×(命中/放行/误报防线) ≈ 15 条；queryResultType 分支 ≈ 6 条 |
| typecheck/scope | 作用域收容/forof 展开未知放行 |
| typecheck/index | emit 定序快照（error→warning→layer）；现有 push→emit 全量等价回归 |
| llm | 首层挑牌/摘要行/截断；repairLoop 轮间 diff |

红线：`npm test` 272 用例**不许有任何断言变更（改 message 文本的除外，需逐条列出）**。

## 8. 无数据库设计（编译器切面，N/A）

## 9. QA 记录

<rv-add>2026-09-15 落地实测（290 单测全绿，slice/slice:multi 双端 build 通过，jxc/todo 全例 0 问题）：
- 实现 vs 设计偏差：Diagnostic 定义在 typecheck（非 core/types——原设计笔误）；ok 语义 = "无 error 即过"（warning 不阻断，与 ch06 既有口径一致，NULLABLE-HINT 不再阻断合法样例）
- 收窄清单（F3 正确性收紧，样例修正需订阅）：typecheck.test.ts "静态调静态成员" 样例 y.getYear()←String / Date.now()←DateTime 改为 y:Date=Date.now() + n:Integer=y.getYear()——旧宽松策略漏放的错配，现正确拦截
- 新增测试：typecheck/p0.test.ts（15：F1 结构化字段 / F2 定序 / F3 五核对点命中+放行 / F4 assignable / NULLABLE 不阻断 / 兜底红线）、llm/p0.test.ts（3：三段式摘要+首层+轮间 diff）
- message 文案零改动（红线达成）；feedback 格式变更在 F5 验收范围内（llm 存量用例断言 toContain 皆仍通过）</rv-add>
