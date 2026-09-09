# 编译器入门教程（TDSL P0 最小切面）

> 定位：面向新读者的编译器实现入门讲解，围绕 P0 最小切面（五包）逐包拆解。
> 阅读前提：先读 `00_参考资料/NASL调研.md` → `10_设计/设计总览`。
> 配套代码：`packages/*`，示例驱动 `examples/todo-app/scripts/slice.ts`。

## 目录

- [00 总览：流水线与核心哲学](00_总览.md)
- [01 core：语义核 / Typed AST](01_core.md)
- [02 parser：文本 → AST](02_parser.md)
- [03 typecheck：最小类型检查](03_typecheck.md)
- [04 codegen-java：后端生成](04_codegen-java.md)
- [05 codegen-react：前端生成](05_codegen-react.md)
- [06 项目 Tour：功能全景与源码导读](06_项目Tour-功能全景.md)

## 推荐阅读顺序

按依赖方向自底向上：**总览 → core → parser → typecheck → codegen-java → codegen-react**。
看完一篇，对照对应 `packages/*` 源码消化，再进入下一篇。

> 已读完 00-05（P0 状态）？请接着读 **[06 项目 Tour](06_项目Tour-功能全景.md)** ——
> 基于最新代码盘点全部已完成能力（P0 → P1 CRUD → P2 复杂逻辑 → M1 命名空间 / M4 View 声明层 /
> M6 外部能力 / M2 查询语言，120 单测），含逐包源码导读函数索引与动手练习，
> 是掌握当前项目全貌的最佳入口。