# 05 codegen-react：同一棵 AST → React 工程

> 配套代码：`packages/codegen-react/src/index.ts`（2097 行）
> 定位：`generateReact(app)` → `GeneratedFile[]`。有 `views` 时走真生成，无 views 退回固定模板（兼容旧用例）。

## 1. 产出文件全景

```
package.json / vite.config.ts / .npmrc     # 脚手架（.npmrc 锁公网 registry，离线演示不白屏）
index.html / src/main.tsx
src/api.ts                                  # 每个 endpoint → 一个 fetch 函数（路径参数/GET query 拼装）
src/hooks.ts                                # useQuery/useMutation 真实实现（非占位）
src/pages/<Page>.tsx                        # 每个 page → 一个组件
src/App.tsx                                 # react-router 路由表（根路径重定向首个页面防白屏）
```

## 2. 从 binding 到 hooks

parser 已把 `dataSource={useQuery('listOrders')}` 提取成 `BindingNode`；codegen 收集每个页面的
query/mutation/navigate 绑定 → 生成 `const q = useQuery(() => listOrders(), [])` 状态 + 把 `q.data` 喂给组件。
mutation 后自动 refetch 关联 query（按钮提交后表格刷新）。

## 3. ViewElement → antd 组件映射（ANTD_OF）

| TDSL 元素 | 生成 |
|-----------|------|
| `<table dataSource={...}>` | `<Table columns=...>`；column.field 数据驱动列；行内 `<button>` → 操作列 |
| `<form submit={useMutation(...)}>` | 受控表单 + 自动提交按钮 |
| `<input field=...>` | 字段 useState 自动提升到组件顶部 |
| `<repeat field="items">` | 嵌套明细行编辑（`repeatItemStruct` 反查结构类型） |
| `<text field="order.customer" />` | `<span>{data.order.customer}</span>` |
| `<detail dataSource={...}>` | `<Descriptions>` |
| dialog（M4） | 弹窗组件 + `openDialog` 绑定（import 相对路径 `./X`） |

**表单控件按字段类型升级**（实战打磨）：枚举 → `Select`（选项来自 TDSL enum）/ 日期 → `DatePicker` / 数字 → `InputNumber`；
`Page<T>.content` 分页数据、`onRow` 行点击等长尾都有对拍用例锁定。

## 4. G2 前端表达式域（dev/29）

- `derive={qty * price}`：纯函数表达式 → 计算 `readOnly` 属性（typecheck 保证无 IO）
- `carryBy="getGoods"`：拉档填回——选中主键字段后调用函数把档案字段填回表单
- 两者共用"表达式域可见者"约束：兄弟字段 / row / initial / 内核五域别名 / 实体 / 枚举

## 5. 依赖与工程配置（dev/32）

`package.json` 的 dependencies 两路合并：页面骨架默认项（antd/dayjs/react-router-dom）→ **`dependency npm` 声明**（唯一包名来源，dev/33 删 component 注册层；三方组件 import 由声明解析）
`vite.config.ts` 注入 `/api` 代理与错误回流上报地址（M10 运行回路配套）。

## 6. 路由与 `$route`

`routePathOf` 把页面名转 kebab-case（`OrderList` → `/orders`）；binding 参数引用 `$route.id` → 路径自动加 `:id` 段，表达式翻译为 `Number(params.id)`。

## 7. 本包要记住的 3 件事

1. **前端语义来自 AST 的 View 子树**：后端没有的概念（hooks/路由/antd）全部在 codegen 层合成，AST 不被前端细节污染。
2. **声明式绑定是唯一数据通道**：`useQuery/useMutation/navigate` 三种 Binding 覆盖取数/提交/导航，没有"逃生舱口"写裸 fetch。
3. **长尾靠对拍用例锁**：每修一个白屏级 bug（import 路径/Fragment/重复声明）就补一条单测——生成器的回归防线是单测不是人眼。

**动手练习**：给 todo.tdsl 加一个 `page OrderNew`（form + 两个 input + submit），跑 slice 后读 `generated/react/src/pages/OrderNew.tsx`，对照 useState 提升与 api.ts 的 fetch 函数。
