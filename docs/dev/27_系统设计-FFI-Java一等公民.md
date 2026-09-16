# 27_系统设计-FFI：Java 一等公民（目录 = LLM 天生认识的声明形态）

> <rv-add>2026-09 新切面。背景：后端缺标准库（蝙蝠 NASL `nasl.util` 的位置）；
> 自造库 = 重复发明 + LLM 认不得（须 few-shot 教熟），borrow JDK = LLM 天生会。
> 与 dev/25（书写面 TS 化）融合：目录统一为 d.ts 形态——一处产物吃三方。
> Gate 确认：目录模型（每方法 java/js 模板选填，模板存在=该端可调）+ dump 离线并入 + 四域首批。</rv-add>

---

## 1. 决策（D-FFI1~6）

| # | 决策 |
|---|------|
| D-FFI1 | JDK 即 TDSL 标准库；目录 = dump 工具产物人工收窄的精选集（版本化资产；全量 dump 仅底稿） |
| D-FFI2 | TDSL 调用零包裹：`s.contains(x)` / `Order.all.size()` / `Date.plusDays(1)`，无 native.* 前缀 |
| D-FFI3 | 双端策略：成员双模板（两端各译）；单模板（java/js其一）= 单端方法，另一端 typecheck 禁用；jar 纯后端并入、npm 前端由 component/未来 d.ts dump 承接 |
| D-FFI4 | resolver 借此落地（M3 首场景）：receiver 类型已知的成员调用 → 目录存在性检查；未知类型放行（宽松策略不推翻） |
| D-FFI5 | 类型映射复用 type-map（Date→LocalDate、Decimal→BigDecimal、Integer→Long）；目录不造第二套 |
| D-FFI6 | 词法 TS 化、语义核自持（TDSL Date 独立于 JS/Java）；TS 子集的外号"目录=d.ts"即 LLM 认作 npm 库的机制 |

## 2. 已落地（本轮）

- **core/stdlib.ts**：目录模型（FfiClass/FfiMethod: java/js 模板 + static + ret/params）+ 四域精选（String 11 成员/BigDecimal 6/LocalDate 6/LocalDateTime 6/List 6 + count 糖别名）；core 单一 index re-export。
- **typecheck 4.6 道**：静态/实例错配、目录外成员（诊断附 `tdsl bundle-jar` 补录口径）、双端模板约束；单测 4 例（链式传播/目录外成员/错配/未知 receiver 放行）。
- 时序：dump/并入=开发期离线动作；编译期纯 Node 只读目录；缺录诊断附补录命令。

## 3. 下一步（本切面余项）

1. **dump 工具**（`tools/jdk-catalog` javap/反射 → JSON → 人工收窄进目录；`tdsl bundle-jar <jar>` 命令并入通用 jar 机制）
2. **react codegen js 模板翻译**（`contains→includes`、`List.size→length`、日期/数值 backend-only 硬闸）
3. **d.ts 投影**：目录 JSON ↔ d.ts 双向（LLM cheatsheet 注入精选成员；自家 SDK 生成器同机制收编）
4. jxc 样例创意重写示例 ≥10 处标准库调用（验收口径）

## 4. QA 记录

- 目录四域初稿人工编写（本批 dump 工具未接，先以"精选手工目录"验证逻辑链路）
- 任意 jar 并入=机制收口（工具暴露），非新机制
