# AGENTS.md — TDSL 项目约定

## 项目定位
自研低代码 DSL（TDSL）：大模型写 TS 风格 DSL（书写面）→ parser → Typed AST（语义核/SSoT）→ codegen → React + Java。
参考网易 CodeWave NASL 调研（`docs/00_参考资料/NASL调研.md`），设计文档见 `docs/`（README.md 为导航）。

## 核心工程约定（继承 30_详细设计）
- TypeScript **strict**，Node >= 18，npm workspaces（`packages/*`）。
- 节点用**判别联合 + `never` 穷尽**：新增节点类型必须同步更新生成器/编译器，否则编译报错。
- 跨节点引用用 **nodePath 字符串** + 编译期 `resolve` 绑定；悬空引用报诊断。
- codegen 纯函数/确定性输出；错误带 nodePath + 行列。
- **禁止** `as any` / `@ts-ignore` / `@ts-expect-error`。
- 生成产物（`examples/*/generated/`）独立构建，不进 npm workspace。

## 研发流程（enterprise-module-dev 技能适配）
- 开发新功能/模块按六阶段：需求 → 设计 → 编码 → 测试 → 交付，每阶段结束用 `question` 工具 Gate 确认，禁止跳阶段。
- **文档适配**：本项目文档全为 markdown（`docs/` 分 00-99 目录）；`enterprise-module-dev` 技能的 HTML 审阅模式在此**降级为 markdown 行内标记**：`<rv-add>` 新增 / `<rv-del>` 删除 / `<rv-chg>` 修改。QA 跟踪用 `docs/dev/QA记录.xlsx`。
- 文档索引 `docs/index.html` 每次新增/修改文档后同步更新。

## 目录速查
- `docs/10_需求设计` 需求 · `docs/20_系统设计` 架构 · `docs/30_详细设计` 类型/算法
- `docs/dev/` 切面级研发文档（00_需求管理、10_系统设计-最小切面、QA记录.xlsx）
- `packages/` 源码 · `examples/todo-app/` P0 切片 demo

## 本机工具链
Node 24 + npm 11（无 pnpm，用 npm workspaces）；Java 17 (Corretto) + Maven 3.8.5（Java 产物 build）。