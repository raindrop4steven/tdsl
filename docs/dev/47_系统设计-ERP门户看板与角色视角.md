# 47 · 系统设计 — ERP 门户看板与角色视角

> 状态：⏸ 待用户 Gate 确认（阶段二·系统设计）
> 日期：2026-09-16
> 关联：dev/46（需求）、dev/45（交互与链接路）、dev/12（M2 查询语言）

## 1. 改动面分布

| 层 | 改动 | 说明 |
|----|------|------|
| parser | **极小**：`@role('A,B')` 注解收进 `view.annotations`（与 `@title/@menu` 同路径）；`row/col/carousel/item/list` 走既有通用元素解析 | 预计 ~4 行 |
| core | 零改动（`ViewNode.annotations` 已承载 name/value 字符串） | — |
| typecheck | `KNOWN_VIEW_TYPES` 增 `row/col/carousel/item/list`；`statistic/list` 的 `dataSource` 走既有 `useQuery` 绑定校验（含"必须被 interface 暴露"） | 小 |
| codegen-react | 组件映射（Grid/Carousel/List）+ statistic 标量取值 + **角色元数据/过滤/切换器**（App.tsx）+ import 收集 | 主 |
| codegen-java | 零改动（聚合查询与 Service 已支持；统计逻辑是普通 function） | — |
| examples/yudao | 5 个门户页 + 统计 logic + `@role` + spec/check-spec `kind: dashboard` 映射 | 中 |

设计原则沿 dev/44：**不新增 AST 节点**，组件挂既有通用元素；角色挂既有注解。

## 2. 组件映射（codegen-react）

| DSL | 生成物 | import |
|-----|--------|--------|
| `<row gutter=16>` | `<Row gutter={16}>` | Row |
| `<col span={6}>` | `<Col span={6}>`（默认 12） | Col |
| `<carousel autoplay>` + `<item title text>` | `<Carousel autoplay><div><h3>…</h3><div>…</div></div>…</Carousel>` | Carousel |
| `<list dataSource={useQuery('x')}>` + `<item field title>` | `<List size="small" dataSource={q.data ?? []} renderItem={(it) => <List.Item><span>title：{it.field}</span>…</List.Item>} bordered />` | List |
| `<statistic title dataSource={useQuery('x')} />` | `<Statistic title="…" value={Number(qX.data ?? 0)} />`（无 dataSource 时沿用 `value={表达式}`） | Statistic（已有） |

- `item` 在 `carousel` 下为幻灯片、在 `list` 下为行模板（按父元素分派）；
- list 行的枚举/外键三态渲染复用 `columnDefsOf` 的映射（通过 `<item field>` 声明，内部按需套 Tag/引用名）；
- 保留 `tabs/pane`（门户可用多标签）与既有 `card`。

## 3. 聚合查询（react 贯通）

- M2 已支持 `Order.aggregate(sum(total))`（标量，返回 `Decimal/Integer`）与 `.groupBy(x)`（`List<Map<Object>>`）；
- java 端已生成（`aggJpql` / `SUM/COUNT` + Service 组装）；
- react 端补：api 函数签名走既有 `tsType`（Decimal/Integer→`number`），`statistic` 统一 `Number(data ?? 0)`；
- **本轮范围**：标量聚合用于指标卡；`groupBy` 的列表渲染（列名含 `sum(total)` 等不稳定键名）**不做**，记为后续项。

## 4. 角色视角（@role + 外壳）

### 4.1 语言面

```tdsl
@role('老板') @title('经营总览') @menu('门户') page bossDashboard { ... }
@role('采购员') @title('采购门户') @menu('门户') page purchasePortal { ... }
@title('产品列表') @menu('产品管理') page erpProductList { ... }   // 无 @role → 全角色可见
```

- `@role('A,B')`：逗号分隔多角色；解析进 `view.annotations`；
- 无注解 = 全角色（**既有页面零改动**）。

### 4.2 外壳（App.tsx）

```tsx
const ROLE_KEY = 'tdsl-role';
const ROLES = ['老板', '采购员', '销售员', '仓管'];      // 由带 @role 的页面去重生成（稳定排序）
const [role, setRole] = useState(() => localStorage.getItem(ROLE_KEY) ?? ROLES[0] ?? '');
useEffect(() => localStorage.setItem(ROLE_KEY, role), [role]);
// 页面可见性：无 role 注解 → 恒可见；有 → role ∈ roles
const visible = (roles?: string[]) => !roles || roles.length === 0 || roles.includes(role);
// MENU_ITEMS / Routes 均先过滤再生成
```

- Header 右侧放**角色切换 Select**（并标注「演示级角色切换，无鉴权」）；
- 菜单与路由**同时过滤**（避免手输 URL 进不可见页；如需更严格可渲染"无权限"占位，本轮简化）；
- 默认角色：`localStorage` 记忆 → 否则第一个角色；若 app 无任何 `@role` → **不渲染切换器**（普通应用不受影响）。

## 5. yudao 门户样例

| 门户（页面） | @role | 组件构成 |
|--------------|-------|----------|
| 经营总览 `bossDashboard` | 老板 | 4 指标卡（本月销售额/采购额/库存总量/待审批单数）+ 轮播（公告 3 张）+ 待办 list（未审批入库/出库）+ 近期销售 list |
| 采购门户 `purchasePortal` | 采购员 | 3 指标卡（采购订单数/待入库/待付款）+ 待审批入库 list + 退货 list |
| 销售门户 `salePortal` | 销售员 | 3 指标卡（销售订单数/待出库/待收款）+ 待审批出库 list + 回款 list |
| 库存门户 `stockPortal` | 仓管 | 3 指标卡（库存总量/仓库数/今日变动笔数）+ 低库存 list + 库存变动 list |
| CRM 门户 `crmPortal` | 销售员 | 3 指标卡（线索数/客户数/未成交商机数）+ 待跟进线索 list + 逾期回款 list |

新增统计 logic（聚合）：`countErpPurchaseOrder`、`countErpPurchaseInPending`、`sumErpStockCount`、`sumErpSaleAmount`、`countErpSaleOutPending`、`sumErpSaleOutReceiptPending`、`countCrmClue`、`countCrmCustomer`、`countCrmBusinessOpen`、`countCrmReceivablePending` 等（`aggregate(count()/sum(x))` + `where` 条件）。

## 6. 兼容与影响

| 变更 | 兼容性 |
|------|--------|
| `row/col/carousel/list/item` 新组件 | 旧页面不涉及 → 生成不变 |
| `statistic dataSource` | 旧 `value={}` 用法保留 |
| `@role` | 无注解页面/应用行为完全不变；无 `@role` 的应用不生成切换器 |
| 菜单/路由过滤 | 仅在存在 `@role` 时生效 |
| check-spec | 新增 `kind: dashboard` → 映射 `page`；**角色维度不入 spec**（理由：演示级前端过滤，非需求覆盖项） |

## 7. 测试策略

| 层 | 用例 |
|----|------|
| parser | `@role('A,B')` 进 annotations；无 role 时不产注解 |
| typecheck | `row/col/carousel/item/list` 已知；`statistic dataSource` 未 expose 时报错（复用既有规则） |
| codegen-react | Row/Col 栅格、Carousel+item、List+item、statistic 绑查询（`Number(q.data ?? 0)`）、角色过滤菜单/路由、切换器 localStorage、无 @role 应用不生成切换器 |
| codegen-java | 零改动回归 |
| 端到端 | yudao：check 0 问题、聚合查询返回数值（真机）、5 门户渲染、角色切换后菜单变化 |
| 回归 | 全仓单测绿 + 既有样例生成结果不变 + check-spec 不回归 |

## 8. 风险

| 风险 | 对策 |
|------|------|
| 菜单/路由过滤遗漏（手输 URL） | 路由过滤 + 后续可加"无权限"占位；本轮文档标注 |
| 聚合返回空（无数据）→ 指标卡显示 NaN | `Number(data ?? 0)`；空表返回 0 或 null 时显示 0 |
| `list` 与 `table` 语义重叠导致误用 | list 定位只读轻量（无操作列/无分页），文档说明 |
| 角色切换带来"假权限"误解 | Header 标注「演示级角色切换，无鉴权」；需求/设计/手册三处写明 |
