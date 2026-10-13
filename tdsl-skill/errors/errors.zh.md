# 错误速查与修复（tdsl check 诊断）

> [English](errors.md) · **中文**

> `tdsl check` 输出结构化诊断：`[severity] [code] message (file:line:col) + 改成: suggestion`。
> 修复循环：读诊断 → 按 code 查下表 → 改 → **再 check**（全量齐报，一次可修多个）。
> 原则：**error 必须清零；warning（DEP-2/3、FK-REF-NO-QUERY、NULLABLE-HINT）不阻断但要过目**。

## 1. 修复流程（agent 闭环）

```
1. tdsl check <tdsl目录>            # 全量诊断（按 error → warning、声明序排序）
2. 逐条读：code 定位错误类 → 查下表拿"改成"
3. 同层一起修（编译器全量报错，不用一轮一个）；改完重跑 check
4. 0 error 后才算过；build 验证可选（tdsl build）
```

纪律（实战教训）：
- **业务文案/数据写 TDSL**（`@ok`、enum label、按钮 text），不要指望改生成器。
- **外键必须显式 `@ref`**——编译器零推断，命名 `xxxId` 不构成语义。
- 页面用到的函数**必须被 interface 端点暴露**，否则生成的前端 api.ts 缺函数 → 白屏。
- 生成前先清输出目录（孤儿文件会让 mvn 双主类失败）。

## 2. 语法错误（parser，无 code）

| 现象 | 原因 | 改成 |
|---|---|---|
| unexpected / 已废弃提示 | 写了 legacy 词法 `logic` / `:=` / `for-in` | `function` / `const x =` / `for (const x of xs)` |
| 报错行带 `?` `:` 三元 | TDSL 无三元 | `if (...) {...} else {...}` |
| 模板串 `` ` ` `` 报错 | 无模板字符串 | 字符串拼接 `'a' + x` |
| 箭头函数报错 | 无箭头函数 | 普通语句 / for-of |
| `for` 缺 const | `for (x of xs)` | `for (const x of xs)` |

## 3. 实体与查询

| code | 触发 | 改成 |
|---|---|---|
| `DANGLE-REF` | 引用了不存在的实体/结构/逻辑（含跨文件短名写错） | 对齐名字；跨数据源同名加限定名 `erp.Order` |
| `ENTITY-METHOD` | 实体方法误用（如 `get()` 不带参、`all()` 带参） | `Order.get(id)` / `Order.all`（属性不带括号） |
| `ENTITY-WHERE` | where 条件不是 `field op value` | 条件字段必须是实体属性，op 用 `= >= <= > < like in`（`= `是等于） |
| `ENTITY-CHAIN` | 查询链用法错（orderBy 空、limit/page 位置、aggregate 紧跟 where） | 照语法：`.orderBy(f desc).limit(n).page(n,size)`；聚合 `where(...).aggregate(count())` |
| `FOREACH-CONTAINER` | for-of 容器不是 List | 容器用实体查询/已知 List 变量 |
| `LIST-SHAPE` | List 用法/形状不符 | 对照 `xs.add/count/get/contains/isEmpty` |

## 4. 外键 @ref

| code | 触发 | 改成 |
|---|---|---|
| `FK-REF-ENTITY` | `@ref(X)` 的 X 不是实体 | 换成目标实体名 |
| `FK-REF-DISPLAY` | display 字段不存在或不是 String | 换成目标实体的 String 字段（缺省 `'name'`） |
| `FK-REF-NO-QUERY` (warning) | 目标实体缺 `query*` 下拉数据源 | 补一个返回 `List<该实体>` 的查询逻辑 |

## 5. 页面与表单

| code | 触发 | 改成 |
|---|---|---|
| `VIEW-COMPONENT` | 组件标签未匹配（内置表无此名、npm 声明缺失） | 换内置组件，或补 `dependency npm "pkg" import X;` |
| `VIEW-BINDING` | 绑定悬空/错形态（useQuery 指向未暴露函数、navigate 指 dialog、openDialog 指 page） | 见下表细项 |
| `FORM-SEMANTICS` | form/repeat/summary 结构错 | `summary` 的 field 必须匹配同表单 repeat；`of` 与 `expr` 二选一 |
| `SUMMARY-TARGET` | summary field 未匹配 repeat | field 写对应 `<repeat field="items">` 的字段名 |
| `SUMMARY-EXPR` | expr 不是表达式 | `expr={qty * price}`（行上下文纯表达式） |
| `INTERFACE-LOGICREF` | 端点 `-> xxx` 悬空 | 对齐 @export function 名 |

VIEW-BINDING 细项（页面绑定 6 查）：

| message 关键词 | 改成 |
|---|---|
| `悬空逻辑引用` | 绑定的函数不存在——对齐函数名 |
| `没有 interface 端点暴露` | 在 interface 里补一行 `GET '/api/...' -> 函数名` |
| `openDialog 悬空页面` | dialog 名写错 |
| `是 page 而非 dialog` | page 用 `navigate`，dialog 用 `openDialog` |
| `navigate 悬空页面` | page 名写错 |
| `是 dialog…改用 openDialog` | dialog 不进路由，改 `openDialog('X', row)` |

## 6. 依赖声明（DEP-1~4）

| code | 触发 | 改成 |
|---|---|---|
| `DEP-1` | 用了未声明的第三方类 | 顶层补 `dependency java "g:a:v" import { 类名 };` |
| `DEP-2` (warning) | 声明了 java 依赖但 libs/ 无扫描产物 | `tdsl bundle-jar <jar> -o <工程>/libs/x.json` |
| `DEP-3` (warning) | 声明版本 ≠ 产物坐标版本 | 对齐两侧版本 |
| `DEP-4` | alias 撞车（同名类跨 jar，如 fastjson/jackson 都有 JSON） | 改产物 alias，或 `dependency java "..." as ns` 后写 `ns.JSON` |

## 7. FFI / service

| code | 触发 | 改成 |
|---|---|---|
| `FFI-MEMBER` | 成员不在内核目录/依赖产物 | 用可用成员；jar 库成员跑 `tdsl bundle-jar` 并入 |
| `FFI-STATIC` | 实例方法当静态调 | 先 `const x = new 类(…)` 再 `x.m(...)` |
| `MEMBER-UNKNOWN` | struct 变量访问了不存在的字段 | 对齐 struct 声明的字段名 |
| `SERVICE-KIND` | service kind 非法 | 只支持 `dubbo` / `http` |
| `SERVICE-HTTP-OPER` | http service 缺 METHOD+path | `GET '/api/x/{id}' -> fn(...): T;` |
| `SERVICE-MEMBER` | service 成员声明错 | 对照 service 语法（方法签名 / http 操作行） |
| `NULLABLE-HINT` (warning) | 局部变量遮蔽（如 `X.get` 结果判空歧义） | 过目即可，不阻断 |
