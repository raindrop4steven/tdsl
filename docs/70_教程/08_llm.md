# 08 llm：Prompt Pack——让 LLM 会写 TDSL（P2）

> 配套代码：`packages/llm/src/`（examples 410 行 / repair 122 行 / cheatsheet 55 行 / prompt 50 行 / index 20 行）
> 定位：**LLM 书写 TDSL 的全部支撑**。纯函数包——不做任何 LLM API 调用，调用方拿文本自己发请求。

## 1. 三件套

| 模块 | 干什么 | 关键机制 |
|------|--------|----------|
| `examples.ts` | 示例矩阵 | 多领域完整样例；`autoMatchExamples(需求文本)` 按关键词选最相近领域 |
| `prompt.ts` | 五层组装 | 角色 → 语法速查 → 示例矩阵 → 需求 → 输出契约 |
| `repair.ts` | 诊断回流修复 | parse（行列）+ typecheck（nodePath）→ 人话 feedback → LLM 定点重试 |

## 2. 五层 prompt 组装（composePrompt）

```
① 角色      你是 TDSL 编译器的书写前端……禁止输出解释性文字
② 语法速查  SYNTAX_CHEATSHEET（55 行速查表）
③ 示例矩阵  完整可编译样例 ×N（按域选择/自动匹配，默认 2 个）
④ 用户需求  原文注入
⑤ 输出契约  只输出一个完整 TDSL 源文件：不要 markdown fence、不要前后闲话、必须能独立编译
```

**设计原则（D 决策）**：小众语言 LLM 能力主要来自 few-shot 示例（Grammar Prompting 佐证）——所以示例是第一等公民，语法速查只是辅助。

## 3. 示例矩阵永不腐烂（最值得学的一处）

`examples.ts` 里每个示例都要过**单测锁定可编译性**：

```ts
// packages/llm/test：遍历 EXAMPLES，逐个 parse + check，必须全绿
```

首轮就抓到真实 bug（external-service 示例漏字段）。机制自证有效：**示例即文档，文档即测试**——示例与 parser 演进脱节的那一刻，单测就红。

## 4. 诊断回流修复（repair.ts，parser-in-the-loop）

```
LLM 输出 ──validateTdsl──▶ ok?  → AST 交付
                          └─ !ok → feedback（人话）→ 拼进修复 prompt → LLM 重试 ≤N 轮
```

`validateTdsl` 串联 parse 与 typecheck，任一失败产出**可直接回流**的 feedback 文本：

- 语法错误带行列：`语法错误（第 3 行 第 8 列）：...`
- link 阶段失败换口径：`（引用绑定期失败：请检查引用的实体/结构/逻辑/页面是否都已声明）`
- typecheck 诊断经 `humanizePath`：nodePath `app.datasources.erp.entities.Order` → `实体 Order（数据源 erp）`——**语义级提示比行列更好懂**（dev/19 §8）

## 5. 本包要记住的 3 件事

1. **llm 包零 API 调用**：组装/校验/人话化全是纯函数——eval、server、playground 各自接自己的 LLM 通道，共享这套 Prompt Pack。
2. **裁判是编译器不是人**：parser-in-the-loop 让修复闭环不需要人工判卷。
3. **nodePath → 人话是桥**：编译器输出的是可寻址诊断，LLM 需要的是语义描述，`humanizePath` 完成翻译。

**动手练习**：改 `examples.ts` 任一示例里的一处语法（故意写错），跑 `npx vitest run --root packages/llm` 看锁定单测变红——体会"永不腐烂"机制。
