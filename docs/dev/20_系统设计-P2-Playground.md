# 20 系统设计：P2 —— Playground（浏览器端 TDSL 试验台）

> 关联：`10_设计/设计总览.md` §3（模块规划）、`dev/19`（Prompt Pack，示例矩阵复用）、`dev/14`（路线图）
> 状态：**已实现（编码/测试完成，2026-09）** —— `packages/playground`（6 单测 + vite build 通过 + dev server 冒烟）
> 定位：领导演示 + 学习者试验台。左侧写 TDSL，右侧实时看诊断/AST/双端生成代码。
> **优先级说明**：提前于 CLI 与真实 LLM 接入——纯本地能力（无需 API key），演示价值最高。

---

## 1. 目标与验收

### 1.1 前提（已具备，零编译器改动）

- 编译器核心（parse/typecheck/generateJava/generateReact）**全是纯函数**，返回值驱动（`GeneratedFile[]` / `Diagnostic[]`）。
- **全仓零 Node 内置依赖**（已核查）：唯一环境相关的是 `core/id.ts` 的 `crypto.randomUUID()`，浏览器原生支持。
- `@tdsl/llm` 的示例矩阵（5 领域样例）是纯数据，可直接作为 Playground 的示例库。

### 1.2 达成什么

浏览器打开一个页面：
1. **左侧**：Monaco 编辑器（VS Code 同款）编辑 TDSL，300ms 防抖自动编译。
2. **右侧四个 Tab**：
   - **诊断**：parse 错误（行列）+ typecheck 诊断（nodePath 人话化）；parse 错误同步到编辑器红色下划线
   - **AST**：Typed AST 的 JSON 视图（可折叠树）
   - **Java**：生成文件树 + 点击预览内容 + 复制按钮
   - **React**：同上
3. **顶栏**：示例下拉（todo.tdsl 全量订单场景 + llm 示例矩阵 5 域），一键加载。
4. **状态栏**：`✓ 编译通过 · Java 12 文件 · React 9 文件 · 45ms`（或红色错误摘要）。

### 1.3 验收标准

- [ ] `npm run playground -w @tdsl/playground` 启动，浏览器全流程可操作（无需任何后端/API key）。
- [ ] 6 个示例（todo.tdsl + llm 矩阵 5 域）加载即编译，产物内容与 `npm run slice` 一致（对拍）。
- [ ] 故意写错（如 `where(totl > 0)`）→ 编辑器标红 + 诊断面板显示"实体 Order 无字段 tottl"。
- [ ] 纯函数管线（parse→check→双端 generate）有 vitest 测试（逻辑层）；UI 手工验收。
- [ ] 不回归：packages/* 六包测试与 typecheck 全绿。

### 1.4 范围外

- LLM 接入（未来可在编辑器旁加"AI 生成"按钮，本期不做）
- TDSL→JSON→TDSL 双向编辑（AST 只读展示，不做 AST 编辑回写）
- 持久化/分享链接（可后续加 localStorage，本期不做）
- 移动端适配

---

## 2. 技术选型

| 项 | 选择 | 理由 |
|----|------|------|
| 构建 | Vite 5（与 codegen-react 产物同栈） | 团队已有经验 |
| UI | React 18 + 少量手写 CSS（不引组件库） | 演示界面简单，避免拖累构建 |
| 编辑器 | `@monaco-editor/react`（Monaco） | VS Code 同款观感（演示加分）；语法高亮/错误标线开箱即用；体积大但 playground 不在乎 |
| 包形态 | `packages/playground`（workspace 成员，独立 Vite 应用） | 依赖 `@tdsl/*` 源码直出（各包 main 指向 src/index.ts，Vite 直接吃 TS） |

**导入 todo.tdsl**：Vite `?raw` 导入（`import todoTdsl from '../../examples/todo-app/todo.tdsl?raw'`），
单一事实来源，示例与 slice 用同一份文件，不会漂移。

---

## 3. 模块设计

```
packages/playground/
├── package.json          # deps: @tdsl/parser @tdsl/typecheck @tdsl/codegen-java @tdsl/codegen-react @tdsl/llm @monaco-editor/react
├── vite.config.ts
├── index.html
├── src/
│   ├── main.tsx          # 入口
│   ├── App.tsx           # 布局 + 状态编排（唯一有状态的地方）
│   ├── pipeline.ts       # ★纯函数管线：compile(tdsl) → { ast? | parseError?, check, java, react, ms }
│   ├── samples.ts        # 示例清单（todo.tdsl?raw + llm EXAMPLES）
│   └── components/
│       ├── EditorPane.tsx     # Monaco + 错误标线（parse 错误行列 → markers）
│       ├── DiagnosticsTab.tsx # parse + typecheck 诊断列表（复用 llm 的 humanizePath）
│       ├── AstTab.tsx         # JSON 折叠树（自写递归组件，不引第三方树库）
│       ├── FilesTab.tsx       # GeneratedFile[] → 文件树 + 预览 + 复制（Java/React 共用）
│       └── StatusBar.tsx
└── test/
    └── pipeline.test.ts  # 6 示例全绿 + 错误样例诊断 + 双端产物非空（与 slice 同路径）
```

### 3.1 pipeline.ts（核心，唯一值得测的地方）

```ts
export interface CompileResult {
  ok: boolean;
  app?: AppNode;
  parseError?: { line: number; col: number; message: string };
  diagnostics: Diagnostic[];        // typecheck（ok 时应为空）
  java: GeneratedFile[];
  react: GeneratedFile[];
  ms: number;                       // 性能展示（状态栏"45ms"的来源）
}

export function compile(tdsl: string): CompileResult {
  // parse（TdslSyntaxError → parseError，带行列）→ check → 双端 generate
  // check 失败时仍返回已生成代码？→ 不：与 slice 一致，失败则产物为空，诊断面板给原因
}
```

- 诊断展示复用 `@tdsl/llm` 的 `humanizePath`（浏览器安全，纯函数）。
- 与 slice.ts 的唯一差异：不写盘、不触发 build（浏览器内没有 mvn/vite）。

### 3.2 App.tsx 状态编排

```
const [tdsl, setTdsl] = useState(samples[0]);
const result = useMemo(() => compile(tdsl), [tdsl]);   // 300ms debounce（用 useDeferredValue 或手写 timer）
```

- 编辑器 onChange → 防抖 → compile（同步纯函数，几十 ms，无需 Web Worker；若实测卡顿再加）。
- parse 错误 → Monaco `setMarkers`（行列定位）。
- 切示例 → setTdsl（重置 undo 历史可接受）。

### 3.3 已知风险与对策（实施结果）

| 风险 | 对策 | 实施结果 |
|------|------|----------|
| `crypto.randomUUID()` 仅在**安全上下文**可用（localhost OK；**局域网 http IP 演示会抛异常**） | `core/id.ts` 加 fallback | ✅ 已实现（原生不可用时降级手写 uuid v4） |
| Monaco 依赖 CDN 加载（@monaco-editor/react 默认行为），**离线演示会白屏** | 与设计时的"必要时 CDN 化"相反：**改为本地打包**（`loader.config({ monaco })` + editor worker `?worker` 导入） | ✅ 已实现，离线安全 |
| TS 语言服务对 TDSL 报无意义的红色波浪线 | 仅注册 editorWorker（基础编辑），不加载 tsWorker；自写 monarch tokenizer（注解/关键字/内置类型）+ 自定义 tdsl-dark 主题 | ✅ 已实现 |
| check 失败时右侧 Java/React 面板为空，观感差 | Tab 显示"编译未通过"占位说明，引导看诊断 Tab；诊断 Tab 加红色圆点提醒 | ✅ 已实现 |
| Monaco 主 chunk 大（~3.5MB） | 演示场景可接受（vite build 有警告，不阻塞） | 已知，接受 |

---

## 4. 测试策略

- **逻辑层（vitest）**：pipeline 六示例全绿；错误样例（语法错/悬空引用/未知字段）诊断正确；
  双端产物文件数 > 0 且与 slice 输出一致（抽查关键文件内容前缀）。
- **UI（手工）**：验收标准 §1.3 全流程过一遍。

## 5. 不做（对齐 dev/19 边界风格）

CLI、LLM 按钮、AST 编辑回写、持久化、分享链接、多文件工程（单文件 TDSL）。

---

## QA 记录（本阶段）

| 序号 | 问题描述 | 结论 | 状态 |
|------|----------|------|------|
| 1 | Gate2（设计）确认 | 用户确认通过，进入编码 | 已关闭 |
| 2 | Monaco 默认走 CDN，离线演示会白屏 | 与设计预想相反，改为本地打包（loader.config + ?worker）——离线安全优先 | 已关闭 |
| 3 | TS 语言服务对 TDSL 误报 | 只用 editorWorker + 自写 monarch 高亮器，不加载 tsWorker | 已关闭 |
