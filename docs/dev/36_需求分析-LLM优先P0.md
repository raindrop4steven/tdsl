# 36 需求分析 - LLM 优先 P0（诊断结构化 / 表达式类型核对 / 修复出牌）

> <rv-add>2026-09-15 编码完成（F1-F5 全部落地，290 单测全绿）。QA 轨迹：①ok 语义修正——按 ch06 既定口径"任一 error 才失败，warning 不阻断"（修复 NULLABLE-HINT 对合法样例的误阻断）②存量样本放行依赖收敛 1 例：FFI 样例 y.getYear→String / Date.now→DateTime 为宽松期混过的错配，改为类型正确写法（y:Date=getYear; Integer 承接），属 F3 正确性收紧。来源：dev/35 商用就绪清单第一优先，用户指令 "do" 启动实施。本切面覆盖 P0 三项（编译器三件事 + llm 出牌策略），业务表达力子项已有设计文档（dev/29/30），本文档定位 P0 整体的需求边界与验收，设计细节分文档引用。</rv-add>

## 1. 背景与问题

LLM 是唯一消费形态（dev/35 北极星：意图拦不了，其他都能拦）。当前两类缺口的代码事实：

1. `Diagnostic`（typecheck/src/index.ts:20-28）只有 `path/line?/col?/file?/message/severity`——无结构化 `code`，修复方向散落在 message 文本里；诊断无依赖序排序，一个悬空 TypeRef 连坐出查询链/FFI/ForEach 多条
2. typecheck 无表达式层核对（自述"最小类型检查"）——LLM 五类高频错静默过关、运行时才炸且无反馈可修

## 2. 功能点列表

| # | 功能点 | 现状 | 目标 | 归属包 |
|---|--------|------|------|--------|
| F1 | 诊断 code + suggestion 字段 | 无 | `Diagnostic{code, suggestion?}` 一等字段；现有编号（D-dep-*）与全部诊断收口归类 | typecheck / core |
| F2 | 诊断排序与级联分组 | 无序 | 全量齐报不截断；依赖序排序（根因在前）；连坐诊断分组归属 | typecheck |
| F3 | 表达式类型核对 | 放行 | 赋值/传参类型错配、logic 互调 arity、成员访问字段存在性、return 核对、nullable 五类拦 | typecheck |
| F4 | 变量作用域正式化 | knownVars 只有名字（ForEach 检查内临时集合） | 独立作用域表（声明类型 + 初值类型推导），F3 依赖它 | typecheck |
| F5 | 修复出牌策略 | repair.ts 全量倒给 | 从全量有序诊断挑牌：分级出牌（语法→类型→业务一轮一类）+ diff 摘要 + token 截断 | llm（调用方侧） |

## 3. 验收口径（对应 dev/35 三条）

1. **拦截完备**：dev/26 进销存 spec + todo 全套样例上，五类表达式错误注入后 typecheck 必须报错（携带 code）；宽松放行仅作为"无法静态判定"的兜底保留
2. **全量齐报**：任何 check 输出不截断；排序可验证（根因在连坐之前）
3. **修复收敛**：dev/31 基线重跑——修复 ≤3 轮成功率不低于现状 5/7，且按 code 维度可统计

## 4. 边界与约束

- 不做：dev/35"不做"清单全部（harness 侧、LSP、round-trip、迁移器、增量、延迟基线、安全审计、服务化、API 面导出、src 目录形态）
- 编译器契约保持"全量齐报"——出牌只在 llm 层做，typecheck 不感知调用方
- 宽松放行为兜底（AGENTS.md 既定策略）：无法静态推导不报错；本次收紧仅限"声明可查"的表达式核对
- 兼容性：`Diagnostic` 新增字段必须向后兼容（老消费方不传新字段仍可编译）；humanize 路径文案不变

## 5. 外部依赖

- 现有：resolve/nodePathOf（core）、createCatalog/FFI 目录（dev/27/32）、dev/31 eval 基线
- 新增：无第三方依赖（全部本仓内闭环）

## 6. 里程碑订单（阶段设计 CAD）

F1/F2（诊断结构化，1-2 周）→ F3/F4（表达式核对，1-2 人月）→ F5（出牌，1-2 周）→ dev/31 回归验收。业务表达力（try/join/G2）不在本切面，各自走既有设计文档（dev/30/28/29）独立立项。
