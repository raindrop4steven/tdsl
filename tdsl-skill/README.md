# TDSL Skill 集（agent 知识包）

> [English](README.en.md) · **中文**

> 给 LLM/agent 写 TDSL 时看的完整知识包：语法参考、few-shot 示例、错误修复、真工程参照。
> 配套编译裁判：`@tdsl/cli`（`tdsl check / generate / build`）。**写→check→修→再 check** 是最短闭环。
>
> 构建原则：`fewshot/basics.md` 与 `demo-yudao/` 均来自**编译通过的工程/单测锁定示例**，不是手写文档——防止示例漂移。

## 工作流（agent 写 TDSL 的标准动线）

```
1. 读用户需求 → **先写/改 spec.yaml**（结构化需求，见 spec/SKILL.md；有工程 spec 则对照修改）
2. 不确定怎么写    → 按本 README 路由表挑 skill
3. 需要照抄的例子  → fewshot/ 挑可编译示例
4. 按 spec 写分片 .tdsl → tdsl check <tdsl目录>
5. 有诊断          → 读 errors/ 速查表 → 改 → 再 check（循环到 0 error）
6. check-spec 对照 → 缺口清单就是没写的部分，补齐到 100%
7. 全部绿后        → 可选 tdsl generate / build 验证双端产出
```

> 分片习惯（多文件工程）：按功能域纵向切（模型/产品/库存/采购/销售/财务/CRM…），每片顶部 `@datasource(...)` 归属同一应用；跨文件共享全局命名空间，实体/枚举/函数/页面名全局唯一。参照 `demo-yudao/`。

## 路由表

| 你想做什么 | 去哪 |
|---|---|
| 忘记某条语法 / 首次接触 | `syntax/SKILL.md`（完整语法，权威参考） |
| 接到业务需求要开工 / 需求模糊要结构化 | `spec/SKILL.md`（spec 先行工作流 + 六层格式） |
| 想要一个能编译的完整例子照着写 | `fewshot/basics.md`（5 个基础示例，单测锁定可编译） |
| 写企业应用想用实战范式（外键/状态化按钮/明细/抽屉/门户） | `fewshot/patterns-yudao.md`（节选 yudao 真工程） |
| `tdsl check` 报错了 | `errors/errors.md`（错误码速查 + 修复纪律） |
| 想仿照一个完整的真实企业工程 | `demo-yudao/`（芋道 ERP/CRM 子集：spec.yaml 需求 Spec + 8 分片，可编译） |

## 各目录

```
README.md            # 本文档（路由入口）
spec/                # Spec 先行：SKILL.md（需求→spec→tdsl→对照 工作流 + 六层格式）
syntax/              # 语法全书：SKILL.md
fewshot/             # 示例：basics.md（基础）/ patterns-yudao.md（企业范式）
errors/              # 修复：errors.md（错误码速查 + 流程）
demo-yudao/          # 真工程参照：spec.yaml + tdsl/*.tdsl 8 分片 + 说明
```

## 来源与版本

- 语法形态与语义以 `docs/70_教程/20_语法手册.md` 为源；本包是它的"给 agent 用"提炼。
- fewshot 基础示例源 `packages/llm/src/examples.ts`（单测锁定可编译）。
- demo 源 `examples/yudao/`（check 0 问题、双端 build 通过）。
- 配合编译器版本：见 `tdsl` CLI 命令版本（`tdsl check` 为准）。