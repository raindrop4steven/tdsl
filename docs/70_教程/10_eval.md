# 10 eval：评测基线与 Spec 对拍（C4 / SDD）

> 配套代码：`packages/eval/src/`（harness 185 行 / samples 167 行 / provider 78 行 / run 56 行 / spec 19 行）+ `examples/jxc/scripts/check-spec.ts`
> 定位：**回答"TDSL 表达力与 LLM 生成质量到底怎么样"**。两条腿：C4 样卷实测 + SDD spec 对拍。

## 1. 为什么需要它（主线校准）

一句话生成（"帮我做个进销存"）测不出 DSL 表达力——需求模糊度吞掉了语言差异。
主线因此转向 **Spec 驱动（SDD）**：结构化 Spec → TDSL → 自动对照。
对标 CodeWave 的交付形态：需求方写 spec，编译器链保证 TDSL 与 spec 一致。

## 2. C4 样卷评测（harness.ts）

```
样卷 ──composePrompt──▶ LLM ──stripCodeBlock──▶ validateTdsl ──修复闭环 ≤N──▶ 绿则双端 build
```

- **样卷**（`samples.ts`）：jxc spec 按 5 模块切（含共享数据字典节选）+ fastjson2 demo + todo——每份是独立可评测的结构化需求
- **指标**（`EvalRecord`）：首轮 parse/check 通过、修复轮次、finalPass、双端 build、耗时
- **产物落盘**：`evaluation/`（gitignore 性质，按运行时时间戳归档）——spec.md + TDSL + 记录
- **provider**：OpenAI 兼容直发 fetch（不经 pi SDK）；env 与 server 同源（`TDSL_LLM_*`）；GLM 网关超时 5min×重试 5；**会话头固定**（OpenCode Go 网关踩坑重现的防御）
- **llm 可注入**：`LlmCall` 是函数参数——单测用 mock，实跑换真端点

首轮实测（dev/31）：7 样卷首轮可编译 3/7，修复 ≤3 轮到 5/7；失败分类：parse 词法长尾 / FFI 精析余项 / 非确定性波动。

## 3. Spec 对拍（check-spec，SDD 的标尺）

`examples/jxc/spec.yaml`（六层：系统→模块→功能→页面→按钮→字段）→ `check-spec` 自动对照 TDSL 实现：

```
npm run check-spec -w jxc
检查项: 287  缺口: 0  覆盖率: 100.0%   （缺口非零 → exit 1，可进 CI）
```

五维对照：实体/字段、枚举、逻辑、页面、按钮——**每条 spec 都能在 TDSL 里找到落点**。这是"语言完备度"的验收姿势：不再"我们手写全覆盖"，而是"LLM 生成 + 编译器裁判 + spec 对拍"的自动化验证链。

## 4. 三层验证体系（全链路无人工判卷）

| 层 | 锁什么 | 工具 |
|----|--------|------|
| 单测锁示例 | 示例矩阵可编译性 | llm 包单测 |
| spec 锁覆盖度 | 功能需求 ↔ TDSL 落点 | check-spec（287 项） |
| eval 锁生成质量 | LLM 首轮/修复/build | harness 样卷跑批 |

## 5. 本包要记住的 3 件事

1. **评测是 compiler 的镜子**：eval 失败分类直接产出改进项（C4 报告 → C1 小补丁 → B3 SDK 生成器的排期依据）。
2. **spec 是可执行的验收标准**：exit code 能进 CI，覆盖度是数字不是感觉。
3. **jxc 是第一个完整测试样例**：13 实体/5 枚举/32 函数/15 页面，它暴露的 7 项表达力缺口（枚举 label/表单联动/where+aggregate）就是语言 roadmap。

**动手练习**：跑 `npm run check-spec -w jxc` 看满绿报告；再到 `packages/eval/src/samples.ts` 挑一份样卷需求文本读一读，体会"结构化 spec"与"一句话需求"的差别。
