# 09 server：在线 TDSL Agent（M9 + M10）

> 配套代码：`packages/server/src/`（index 329 行 / tools 283 行 / sessions 310 行 / runner 234 行 / workspace 115 行 / export 29 行）
> 定位：**浏览器里的 TDSL 工程师**。聊天页提需求 → agent 写 TDSL 分片 → 编译自修 → 起前后端实测 → 报错回流自修。
> 启动：`npm run server`（http://localhost:8787）。

## 1. 模块结构

| 模块 | 干什么 |
|------|--------|
| `index.ts` | HTTP 服务：静态聊天页 + WS 流式 + GLM env 注入（含 compat 透传） |
| `sessions.ts` | 会话装配：pi SDK（turn loop / 上下文压缩 / 持久化）+ 沙箱 + 工具 + 事件转发 |
| `tools.ts` | TDSL 领域工具 ×N：agent 与编译器之间的**唯一接口** |
| `workspace.ts` | 会话沙箱：`tdsl/` 分片 + `generated/` 产物 + `logs/` |
| `runner.ts` | M10 运行回路：前后端进程编排状态机 |
| `export.ts` | 产物导出 zip（java/react/all） |

## 2. 领域工具（tools.ts，最值得精读）

| 工具 | 作用 | 关键设计 |
|------|------|----------|
| `compile_tdsl` | **唯一裁判**：`parseProject + check` → 人话诊断 | 诊断封顶 10 条（连锁错误先修已列出的，不撑爆上下文） |
| `read_tdsl` | 读分片 | 只给清单+按需读（上下文按需拉取，M10 实战打磨） |
| `write_tdsl_files` | 写分片 | 多文件分片形态（M7） |
| `generate_code` | 双端 codegen 落盘 | **清旧产物**再写（防 CLI 手动重刷时孤儿 Java 主类导致 mvn 双主类失败） |
| `run_app` | up/down/restart/status/logs | 编排 runner（M10） |

**逻辑层纯函数**纪律延续：`compileSandbox(ws, appName)` 等核心都是可测纯函数，`defineTool` 只是 pi 循环的薄封装——22 个单测全走逻辑层。

## 3. 运行回路（runner.ts，M10）

```
状态机：idle → starting → up / failed → down
```

- 每会话一组进程：`mvn spring-boot:run`（H2 内存库零安装）+ `vite dev`
- 端口 = 基数 + 会话序号；`/api` 代理到后端；**全局并发 ≤3**（Gate 决策）
- `/healthz` 探针等后端就绪（90s 超时）；日志环形写入沙箱 `logs/`（200KB 截头保尾）
- `logTail` 自动 grep `ERROR|Exception|FATAL|error TS` 摘要 → agent 读日志自修的输入

## 4. 错误回流闭环（M10 的灵魂）

```
后端日志 ERROR ──grep──▶ agent（logTail）
前端运行时错误 ──reporter──▶ vite 注入 __REPORT_URL__ ──▶ client.log ──▶ agent
```

vite.config 注入上报地址，前端自动采集未捕获异常/拒绝与 HTTP ≥400。实战首例：用户报前端白屏 → client-error 回流 → 定位到 agent 漏写 interface → **反哺出 typecheck 新诊断**（"绑定逻辑必须被 interface 端点暴露"）——反馈闭环第一次真跑通就产出了编译器增强。

## 5. 踩坑实录（M10 实战周，均有 commit）

| 坑 | 修法 |
|----|------|
| OpenCode Go 网关要求会话头（MissingSessionID） | compat 强制 `sendSessionAffinityHeaders` |
| GLM 超时 | 放宽 5min + 重试 5 |
| 会话恢复失败 | 自动换新会话 |
| agent 上下文爆炸 | read 只给清单 / 诊断封顶 10 条 / generate 目录聚合 |
| 用户不知道 agent 在干嘛 | 思考状态可视化（🤔 计时器）+ 🐞 调试面板 + agentEventLogger→logs/agent.log |

## 6. 本包要记住的 3 件事

1. **agent 不碰编译语义**：所有"懂 TDSL"的逻辑都在编译器包里，server 只做编排与回流。
2. **compile_tdsl 是纪律工具**：agent 每次写完必须过编译——LLM 自由度被确定性裁判约束。
3. **运行回路让反馈闭环真实**：编译通过 ≠ 能跑，用户实测的错误回流才是质量闭环的最后一段。

**动手练习**：`npm run server` 起服务，浏览器提一个小需求，观察聊天页的编译裁判往返；然后打开沙箱目录看 `tdsl/` 分片与 `logs/`。
