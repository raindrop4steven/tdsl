# 19 系统设计：P2 —— LLM 书写面教学与 Prompt Pack

> 关联：`10_设计/设计总览` D4/D5（书写面定位，**口径已修正：TS 风格 + 领域扩展，非严格 TS 子集**）、
> `10_设计/设计总览` §7（LLM 集成管线）、`docs/dev/14`（路线规划）、`70_教程/06_项目Tour`（当前能力全景）
> 状态：**已实现（编码/测试完成，2026-09）** —— `packages/llm`（12 单测）
> 定位：解决"**怎么让大模型写出能被我们 parser 稳定接受、typecheck 干净通过的 TDSL**"——
> 这是 P2 LLM 集成切面的核心设计，早于一切 API/工程化问题。

---

## 1. 目标与验收

### 1.1 现状问题

TDSL 语法目前只存在于两个地方：parser 源码（`parser.ts` 1059 行）与教程文档。**没有任何面向 LLM 的输入**。
自然语言需求 → TDSL 这一步完全空白，而它的质量直接决定整条管线的废品率与重试成本。

### 1.2 达成什么

1. **Prompt Pack**：一套可组装的 prompt 组件（语法速查 + 示例矩阵 + 输出契约），由 core 节点模型**合成生成**（语法演进不漂移）。
2. **示例矩阵**：按"概念切片"组织的完整可编译样例库（每个样例都过 parse + typecheck，CI 保证不腐烂）。
3. **校验修复闭环**：parse/typecheck 诊断（带行列 + nodePath）回流给 LLM 定向重试，N 轮收敛。
4. 双通道中**确定路径 A（TDSL 直出）为主**；路径 B（JSON AST 直出）仅作备选不本期实现。

### 1.3 验收标准

- [ ] PromptPack 可由 `packages/llm` 一键合成（输入：AppNode 类型清单 + 示例矩阵），输出纯文本 prompt。
- [ ] 示例矩阵中每条样例 `parse + check` 全绿（作为单测常驻，防示例腐烂）。
- [ ] 诊断回流修复：parse 错误消息带 `line/col`，typecheck 带 `nodePath`，可直接映射为"第几行第几列、哪个节点错了"。
- [ ] 端到端冒烟：给定一段自然语言需求，LLM + PromptPack + 修复闭环产出可编译 TDSL（人工评估样本 ≥ 5 个领域）。

---

## 2. 研究依据：示例主导，规则是围栏

### 2.1 记忆中的"80/20"结论

项目早期调研（NASL 阶段）引用过 Google 的一项研究结论：**对小众/低资源语言，LLM 的能力约 80% 来自示例（few-shot demonstrations），语法规则等显式说明只占约 20%**。
> ⚠️ 出处待考证（结论方向可信，精确比例请以最终引用为准）。该方向与可查证的研究一致：

- **Grammar Prompting for Domain-Specific Language Generation**（Wang et al., NeurIPS 2023）：把 BNF 文法塞进 prompt 前缀，对低资源 DSL 生成有显著提升——但前提是**模型已具备相近语言的基础能力**，文法只起"约束对齐"作用。
- 低资源编程语言综述/实测的一致发现：**few-shot 示例贡献主导**，显式规则边际收益小、且主要减少"约束类"错误（保留字、转义、分隔符），对"语义正确性"几乎无贡献。

### 2.2 由此推出的三条设计原则

| 原则 | 设计含义 |
|------|----------|
| **P1 Demo-first**：示例是教学主体 | Prompt Pack 的篇幅大头给示例矩阵；语法速查压缩为几百 token 的"围栏"，防止概念拼错，而非教会语义 |
| **P2 示例按域检索**：一个完整领域样例 > 十个碎片片段 | 示例库按业务域组织（CRUD 单表 / 主子表 / 查询报表 / 外部服务），按需求选 1-2 个最相近的完整样例注入 prompt |
| **P3 Parser-in-the-loop**：语义正确性靠校验闭环兜底 | 不指望 prompt 一次写对；把 parser（行列错误）与 typecheck（nodePath 诊断）作为确定性裁判回流修复 |

> 与 TS 严格子集性的关系（D4 口径修正后的再定位）：我们已确认 tsc 不适用、自家 parser 是权威裁判，
> 这反而**强化**了 P3——闭环的裁判本来就是我们自己的编译器，而非外部工具。

---

## 3. Prompt Pack 结构（五层组装）

```
┌─ ① 角色与任务（固定 ~100 token）
│    "你是 TDSL 编译器的书写前端，输出可被 parser 编译的 TDSL……"
├─ ② 语法速查（固定 ~400 token，"围栏"）
│    全部概念的骨架一览（见 §4），一行一概念，只写形态不写语义
├─ ③ 示例矩阵（大头，~2-4k token，按域检索）
│    1-2 个与需求最相近的完整样例（§5），每个都是 parse+check 全绿的可编译 TDSL
├─ ④ 需求描述（用户自然语言）
└─ ⑤ 输出契约（固定 ~100 token）
     "只输出 TDSL 源码，不要 markdown 代码块包裹，不要解释，单文件"
```

组装逻辑（`packages/llm` 的 `composePrompt`）：固定层 ①②⑤ 进模板常量；③ 由**示例检索器**按
需求关键词/实体域命中（先用规则匹配，后可换向量检索）；② 的类型清单从 `core` 的节点定义合成。

---

## 4. 语法速查（②层内容骨架，~400 token）

> 只给"形态"，语义靠示例承载。语法演进时此表由代码/文档同步维护。

```ts
// ---- 声明（领域扩展，TS 无对应）----
@datasource('dsName')            // 声明/切换数据源；此后 entity 归入该数据源
entity Order { id: Integer @pk; total: Decimal; createdAt: DateTime }   // @pk @nullable @unique
struct OrderInput { items: List<OrderItemInput> }                        // DTO
enum Priority { LOW, HIGH }
interface OrderApi { GET '/api/orders/{id}' -> getOrderDetail }          // GET/POST/PUT/DELETE
page OrderList { <table dataSource={useQuery('listOrders')}> ... }       // JSX 子集，见示例
@service(kind='dubbo', group='x', version='1.0')  service UserSvc { getUser(id: Integer): User; }   // kind 也可 bean/http；http 形态 GET '/path' -> opName
component RichTable { pkg: 'antd-pro-table'; defaultProps: {...}; events: ['onRowClick'] }

// ---- 逻辑（TS 风格 + 两处有意偏离）----
@export
logic createOrder(input: OrderInput): Order {
  if (input.items.count === 0) { return null; }
  order := new Order();              // ← 偏离①：:= 声明（无 let/const）
  order.total = 0;
  order.save();                      // 实例方法：save() / delete()
  for (it in input.items) { ... }    // ← 偏离②：in 遍历元素（语义同 for-of，非 TS for-in 键遍历）
  return order;
}

// ---- 实体查询（领域 DSL）----
Order.all                           // 全表
Order.get(id)                       // 主键查
Order.where(total > 0)              // 条件：= >= <= > < like in；逗号分隔 = AND；条件内 && ||
Order.where(a like '%x%', b >= 1).orderBy(total desc).limit(10)          // 链式
Order.where(...).page(n, size)      // 分页，返回 Page<Order>
Order.aggregate(sum(total)).groupBy(customer)                            // 聚合：sum/avg/max/min/count

// ---- 类型 ----
Integer Decimal String Boolean Date Time DateTime   // 内置（非 TS 的 number/string/Date！）
List<T>  Map<T>  Page<T>  实体/结构/枚举短名        // 引用类型；跨数据源同名用 dsName.Entity
```

---

## 5. 示例矩阵（③层，教学主体）

### 5.1 组织方式：概念切片 × 领域样例

| 领域样例 | 覆盖概念 | 来源 |
|----------|----------|------|
| **CRUD 单表**（todo/备注） | entity/struct/logic/interface/page 全套最小形态 | `todo.tdsl` 精简版 |
| **主子表/扁平表外键**（订单） | 嵌套 `List<struct>`、for-in 明细写入、Decimal 算术、事务、详情页、repeat 表单 | `todo.tdsl` 订单场景（现成） |
| **查询报表** | where 复合条件、orderBy/page/limit、aggregate+groupBy、Page<T>/Map 返回 | 单测 `parser/M2` 样例改编 |
| **外部服务** | service(dubbo/bean/http) 声明与调用、component 注册与页面引用 | 单测 `parser/M6` 样例改编 |
| **多数据源** | `@datasource` 多次声明、`dsName.Entity` 限定名 | 单测 `parser/M1` 样例改编 |

### 5.2 关键约束（CI 保证）

- **每个示例都必须是可编译的**：作为单测常驻（`parse + check` 全绿），示例与 parser 演进同锁，**永不腐烂**。
- 示例带行内注释标注"偏离点"（`:=`、for-in、领域 DSL），LLM 对注释敏感，这是低成本的对齐手段。
- 完整样例优先于片段：LLM 从一个能自洽的领域样例里归纳模式的能力，远强于记忆离散规则（§2 结论）。

---

## 6. 校验修复闭环（P3 的落地）

```
需求 + Prompt Pack ──▶ LLM ──▶ TDSL 草稿
                                 │
                     ┌── parse ──┤ 成功 → typecheck
                     ▼           │
              修复循环（≤ N=3 轮）
              [TdslSyntaxError: line/col + message] ──▶ 拼回 prompt：
              "你输出的第 X 行第 Y 列有语法错误：<原错误>。只需输出修正后的完整 TDSL。"
                                 │
                     typecheck 失败 → 同样回流：
              "[nodePath]: message（悬空引用/无方法/条件字段不存在…）"
                                 │
                                 ▼
                        Typed AST ──▶ codegen 双端
```

- parser 已具备：`TdslSyntaxError{line, col, message}`（`lexer/parser` 行列游标）——天然适合回流。
- typecheck 已具备：`Diagnostic{path, line?, col?, message}`，`path` 是 nodePath，可进一步给 LLM
  映射为"哪个实体/逻辑/页面"的语义级提示（比行列更好懂）。
- 修复 prompt 策略：**要求输出完整修正稿**（不做 diff 修补，避免 LLM 改错位置）；错误信息原样引用。
- 超过 N 轮失败 → 降级路径：把失败样本记入示例库反例集（负例也是教学素材），或转人工。

---

## 7. packages/llm 的切面边界

| 模块 | 本期做 | 明确不做 |
|------|--------|----------|
| `prompt/` | composePrompt（五层组装）+ 语法速查模板 + 输出契约 | 任何具体 LLM API 调用 |
| `examples/` | 示例矩阵（5 领域样例，单测锁定可编译性） | —— |
| `repair/` | parse/typecheck 诊断 → 修复 prompt 的格式化 | 自动"无 LLM 修复"（结构化自修复留待后续） |
| 双通道 | 仅路径 A（TDSL 直出） | 路径 B（JSON AST 直出）与 zod schema 包（范围外，见 dev/00） |

CLI/playground、prompt 版本管理、评测基准（生成质量回归）留待 P2 后续切面。

---

## 8. 风险与对策

| 风险 | 对策 |
|------|------|
| 语法演进后示例/速查表漂移 | 示例进单测（可编译性锁定）；速查表在 PR checklist 中与 parser 变更绑定检查 |
| LLM 混用 TS 习惯（`let`/`const`、`===` 之外的 `==`、TS 类型名） | 速查表"偏离点"显式警告 + 反例注释；修复闭环兜底 |
| 需求域超出示例矩阵覆盖 | 示例检索器无命中 → 注入"最通用 CRUD 样例"并提升重试轮数；新域样例沉淀为交付的一部分 |
| 诊断消息对 LLM 不友好 | 修复层做一层"LLM 可读化"包装（nodePath → "实体 Order 的逻辑 createOrder"） |

---

## QA 记录（本阶段）

| 序号 | 问题描述 | 结论 | 状态 |
|------|----------|------|------|
| 1 | "80/20"研究出处 | 方向与 Grammar Prompting（NeurIPS 2023）等一致；精确出处待考证，按"示例主导"原则设计，不依赖具体比例 | 待引用核实 |
| 2 | 路径 B（JSON 直出）是否本期做 | 否——TDSL 直出 + 修复闭环已闭环；JSON 直出仅在未来编辑器/外部系统接入时按需补 | 已决策 |
| 3 | Gate2（设计）确认 | 用户确认通过，进入编码 | 已关闭 |
| 4 | 示例可编译性单测立刻抓到一个真实 bug | external-service 示例的 Order 漏了 total 字段（orderStats 聚合报"无字段"）——验证了"示例永不腐烂"机制有效 | 已修复关闭 |
| 5 | link 阶段错误反馈带 line 0/col 0 对 LLM 无意义 | validateTdsl 优化：line/col 均为 0 时改用"link 阶段引导语"（检查引用是否已声明） | 已关闭 |
