# TDSL 编译器教程（当前版 · 2026-09）

> 定位：面向新读者的编译器实现讲解，基于**当前代码实测**（261 单测全绿、10 包）逐包拆解：
> 编译器整体设计 → 流水线 → 每个包的设计与源码导读。
> 阅读前提：先读 `00_参考资料/NASL调研.md` → `10_设计/设计总览.md`。
> 配套代码：`packages/*`，示例驱动 `examples/todo-app/scripts/slice.ts`。
>
> 历史版本：P0 五包时代的逐包入门讲解（00-05）与当时的全景 Tour 已归档至 [v1/](v1/README.md)，
> 其"教学脚手架"式的讲法仍值得一看，但数据与能力盘点已过时。

## 目录

- [00 总览：流水线与核心哲学](00_总览.md)
- [01 core：语义核 / Typed AST / FFI 目录](01_core.md)
- [02 parser：文本 → AST（双语法 + 绑定）](02_parser.md)
- [03 typecheck：六类诊断与宽松策略](03_typecheck.md)
- [04 codegen-java：同一棵 AST → Spring Boot](04_codegen-java.md)
- [05 codegen-react：同一棵 AST → React 工程](05_codegen-react.md)
- [06 工具链与外壳：总索引](06_工具链与外壳.md)
  - [07 cli：命令行工具 + bundle-jar](07_cli.md)
  - [08 llm：Prompt Pack](08_llm.md)
  - [09 server：在线 TDSL Agent](09_server.md)
  - [10 eval：评测基线与 Spec 对拍](10_eval.md)

## 推荐阅读顺序

按依赖方向自底向上：**总览 → core → parser → typecheck → codegen-java → codegen-react → 工具链与外壳（06 总索引 → 07~10 逐包）**。
看完一篇，对照对应 `packages/*` 源码消化，再进入下一篇。

## 快速建立直觉（先跑再说）

```bash
npm test              # 261 个单测（十包各自 vitest）
npm run slice         # 端到端：todo.tdsl → parse → typecheck → 双端 codegen → mvn compile + vite build
npm run playground    # 浏览器试验台：左编辑 TDSL，右看诊断/AST/双端代码
```
