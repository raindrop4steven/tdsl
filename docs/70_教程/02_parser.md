# 02 parser：文本 → AST（双语法 + 绑定）

> 配套代码：`packages/parser/src/`（lexer 124 行 / parser 1271 行）
> 定位：递归下降解析 + **linkApp 引用绑定**。产出"已 link"的 Typed AST——所有短名都已换算成 nodePath。

## 1. 三步走

```
源码文本 ──tokenize──▶ Token 流（带行列）──parseAppInto──▶ 裸 AST ──linkApp──▶ 已绑定 AST
```

1. **lexer**：ident / string / number / punct / eof，行列信息保留（语法错误能报 `TdslSyntaxError{line,col}`）。
2. **parseAppInto**：顶层 while 分派（见 §2），递归下降各语法块。
3. **linkApp**：短名 → nodePath 绑定（见 §4），悬空引用在此报错。

## 2. 顶层语法清单（parseAppInto 分派）

```
@datasource('x')   @service(kind='dubbo', ...)   @title('中文')  @menu('模块')  @export
entity / struct / enum / logic | function / interface / page | dialog / service / component / dependency
```

`dependency`（dev/32）解析要点：

```
dependency java "com.alibaba:fastjson2:2.0.58";            → { eco:'java', name:'com.alibaba:fastjson2', version:'2.0.58' }
dependency java "g:a" as jackson;                           → ns='jackson'（版本缺省）
dependency npm "antd@^5.21.0";                              → npm 按**最后一个 @** 切 name/version（scoped 包名 @scope/ui 不受影响）
```

java 坐标必须 `g:a[:v]` 三段内，否则语法错误；`parseProject` 合并分片时依赖按 `eco|name|version|ns` 去重。

## 3. 双语法（P11，D4 口径落地）

TDSL 是 **TS 风格 + 领域扩展**，不是严格 TS 子集。兼容期双语法并存，**AST 同构零改动**：

| legacy | TS 面 |
|--------|-------|
| `logic foo(): X { ... }` | `function foo(): X { ... }` |
| `x := expr` | `const x = expr`（可带 `: T`） |
| `for (x in xs)` | `for (const x of xs)` |

实测口径：`:=`/`for-in` 过不了 tsc（TS1109）——自家 parser 是权威校验，不指望 TS 工具链。

## 4. 查询语言的解析技巧（parseCallArgs，最值得精读）

普通 `(` 后无法预知是"普通调用"还是"where 复合条件"，所以**按调用点形态分派实参解析**：

- 接收者是实体（`Order` / `erp.Order`）且方法名 `where` → `parseWhereArgs`：
  条件形如 `field op value`（op ∈ `= >= <= > < like in`），逗号分隔 = AND，条件内 `&&/||` 递归组合。
  右值用 `parseAdditive`（不含比较/逻辑层，防止 `parseExpr` 把 `&&`/`)` 吞进值里）。
- 接收者是"查询链"（`isQueryChain` 递归判断）→ `parseChainMethodArgs`：
  `orderBy(field asc|desc, ...)` 方向解析为 String 字面量参数；`page(n,size)` / `limit(n)` / `groupBy(...)` 走普通参数。
- 其他 → 普通逗号分隔表达式。

数组字面量 `[1,2,3]` → `NewList`（为 `in` 条件服务）。

## 5. linkApp 的绑定策略（M1 核心）

1. 同数据源内实体重名 → `duplicate entity` 报错
2. 全局概念（struct/enum/logic/interface/service/component）重名 → `duplicate type name` 报错
3. TypeRef 引用：`erp.Order` 限定名 / `Order` 短名（`resolveShort` 带上下文数据源优先本源）/ 歧义 → 提示写限定名 / `Object` 内建放行
4. `endpoint.logicRef` 与页面 `Binding.target`（useQuery/useMutation → logic nodePath；navigate → 页面校验）

## 6. 多文件工程（parseProject，M7）

`parseProject(files, appName)`：每分片独立 parse → 合并进一个 AppNode：

- 同名数据源实体**追加合并**；全局概念跨文件去重报重名
- 依赖声明去重（dev/32）
- 顶层声明节点打 `file` 标 → 诊断能定位到分片文件

对拍机制：`npm run slice:multi` 把 todo-multi 五个分片合并结果与等价单文件对拍，**AST 级一致**才通过——合并语义的回归保险。

## 7. 本包要记住的 3 件事

1. **parser 出的是"已绑定" AST**：短名→nodePath 换算发生在 linkApp，下游拿到的引用全部可直接 `resolve()`。
2. **形态分派**是查询语言能长在普通调用语法里的关键——`where` 的实参不是表达式而是"条件"。
3. **双语法是兼容期策略**：AST 同构意味着 typecheck/codegen 对两种写法完全无感。

**动手练习**：写一个含 `erp.Order` 与 `crm.Order` 同名实体的双数据源 TDSL，先用短名引用看歧义报错，再改限定名看绑定结果（`packages/parser/test/parser.test.ts` 的 M1 describe 有现成样本）。
